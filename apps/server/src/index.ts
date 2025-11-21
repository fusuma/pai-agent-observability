import { existsSync } from 'fs';
import { join } from 'path';
import type { HookEvent } from './types';
import {
  createTheme,
  updateThemeById,
  getThemeById,
  searchThemes,
  deleteThemeById,
  exportThemeById,
  importTheme,
  getThemeStats
} from './theme';
import { startFileIngestion, getRecentEvents, getFilterOptions } from './file-ingest';
import {
  createTerminalSession,
  getTerminal,
  resizeTerminal,
  writeToTerminal,
  closeTerminal,
  isPasswordRequired,
  validatePassword,
  type TerminalMessage,
  type TerminalResponse
} from './terminal';

// Store WebSocket clients
const wsClients = new Set<any>();

// Store terminal WebSocket clients with their auth state
interface TerminalClient {
  ws: any;
  authenticated: boolean;
  sessionId: string;
}
const terminalClients = new Map<any, TerminalClient>();

// Start file-based ingestion (reads from ~/.claude/history/raw-outputs/)
// Pass a callback to broadcast new events to connected WebSocket clients
startFileIngestion((events) => {
  // Broadcast each event to all connected WebSocket clients
  events.forEach(event => {
    const message = JSON.stringify({ type: 'event', data: event });
    wsClients.forEach(client => {
      try {
        client.send(message);
      } catch (err) {
        // Client disconnected, remove from set
        wsClients.delete(client);
      }
    });
  });
});

// Static file serving for production
const STATIC_DIR = join(import.meta.dir, '../../client/dist');
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname: string): Promise<Response | null> {
  // Default to index.html for root or SPA routes
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = join(STATIC_DIR, filePath);

  if (existsSync(fullPath)) {
    const file = Bun.file(fullPath);
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return new Response(file, {
      headers: { 'Content-Type': contentType }
    });
  }

  // For SPA: serve index.html for unknown routes (client-side routing)
  const indexPath = join(STATIC_DIR, 'index.html');
  if (existsSync(indexPath) && !pathname.startsWith('/api') && !pathname.startsWith('/events') && !pathname.startsWith('/stream') && !pathname.startsWith('/terminal')) {
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Serve index.html for /terminal route (SPA routing)
  if (pathname === '/terminal' && existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  return null;
}

// Create Bun server with HTTP and WebSocket support
const server = Bun.serve({
  port: parseInt(process.env.PORT || '4000'),
  
  async fetch(req: Request) {
    const url = new URL(req.url);
    
    // Handle CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }
    
    // GET /events/filter-options - Get available filter options
    if (url.pathname === '/events/filter-options' && req.method === 'GET') {
      const options = getFilterOptions();
      return new Response(JSON.stringify(options), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /events/recent - Get recent events
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const events = getRecentEvents(limit);
      return new Response(JSON.stringify(events), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // Theme API endpoints
    
    // POST /api/themes - Create a new theme
    if (url.pathname === '/api/themes' && req.method === 'POST') {
      try {
        const themeData = await req.json();
        const result = await createTheme(themeData);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error creating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes - Search themes
    if (url.pathname === '/api/themes' && req.method === 'GET') {
      const query = {
        query: url.searchParams.get('query') || undefined,
        isPublic: url.searchParams.get('isPublic') ? url.searchParams.get('isPublic') === 'true' : undefined,
        authorId: url.searchParams.get('authorId') || undefined,
        sortBy: url.searchParams.get('sortBy') as any || undefined,
        sortOrder: url.searchParams.get('sortOrder') as any || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      };
      
      const result = await searchThemes(query);
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id - Get a specific theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const result = await getThemeById(id);
      const status = result.success ? 200 : 404;
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // PUT /api/themes/:id - Update a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const updates = await req.json();
        const result = await updateThemeById(id, updates);
        
        const status = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // DELETE /api/themes/:id - Delete a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const authorId = url.searchParams.get('authorId');
      const result = await deleteThemeById(id, authorId || undefined);
      
      const status = result.success ? 200 : (result.error?.includes('not found') ? 404 : 403);
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id/export - Export a theme
    if (url.pathname.match(/^\/api\/themes\/[^\/]+\/export$/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      
      const result = await exportThemeById(id);
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(result.data), {
        headers: { 
          ...headers, 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${result.data.theme.name}.json"`
        }
      });
    }
    
    // POST /api/themes/import - Import a theme
    if (url.pathname === '/api/themes/import' && req.method === 'POST') {
      try {
        const importData = await req.json();
        const authorId = url.searchParams.get('authorId');
        
        const result = await importTheme(importData, authorId || undefined);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error importing theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid import data' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes/stats - Get theme statistics
    if (url.pathname === '/api/themes/stats' && req.method === 'GET') {
      const result = await getThemeStats();
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // WebSocket upgrade for event stream
    if (url.pathname === '/stream') {
      const success = server.upgrade(req, { data: { type: 'stream' } });
      if (success) {
        return undefined;
      }
    }

    // WebSocket upgrade for terminal
    if (url.pathname === '/terminal') {
      const sessionId = crypto.randomUUID();
      const success = server.upgrade(req, { data: { type: 'terminal', sessionId } });
      if (success) {
        return undefined;
      }
    }
    
    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // Serve static files (production)
    const staticResponse = await serveStatic(url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    // Default response
    return new Response('Multi-Agent Observability Server', {
      headers: { ...headers, 'Content-Type': 'text/plain' }
    });
  },
  
  websocket: {
    open(ws: any) {
      const { type, sessionId } = ws.data || {};

      if (type === 'terminal') {
        console.log('Terminal WebSocket client connected:', sessionId);
        const client: TerminalClient = {
          ws,
          authenticated: !isPasswordRequired(),
          sessionId
        };
        terminalClients.set(ws, client);

        // Send auth requirement status
        if (isPasswordRequired()) {
          const response: TerminalResponse = { type: 'auth_required' };
          ws.send(JSON.stringify(response));
        } else {
          // No password required, create terminal immediately
          const response: TerminalResponse = { type: 'auth_success' };
          ws.send(JSON.stringify(response));
          createTerminalSession(
            sessionId,
            (data) => ws.send(JSON.stringify({ type: 'output', data })),
            (code) => ws.send(JSON.stringify({ type: 'exit', code }))
          );
        }
      } else {
        // Default: stream client
        console.log('WebSocket client connected');
        wsClients.add(ws);

        // Send recent events on connection
        const events = getRecentEvents(50);
        ws.send(JSON.stringify({ type: 'initial', data: events }));
      }
    },

    message(ws: any, message: string | Buffer) {
      const client = terminalClients.get(ws);

      if (client) {
        // Terminal message
        try {
          const msg: TerminalMessage = JSON.parse(message.toString());

          if (msg.type === 'auth') {
            if (validatePassword(msg.password || '')) {
              client.authenticated = true;
              const response: TerminalResponse = { type: 'auth_success' };
              ws.send(JSON.stringify(response));

              // Create terminal session after auth
              createTerminalSession(
                client.sessionId,
                (data) => ws.send(JSON.stringify({ type: 'output', data })),
                (code) => ws.send(JSON.stringify({ type: 'exit', code }))
              );
            } else {
              const response: TerminalResponse = { type: 'auth_failed' };
              ws.send(JSON.stringify(response));
            }
          } else if (client.authenticated) {
            if (msg.type === 'input' && msg.data) {
              writeToTerminal(client.sessionId, msg.data);
            } else if (msg.type === 'resize' && msg.cols && msg.rows) {
              resizeTerminal(client.sessionId, msg.cols, msg.rows);
            }
          }
        } catch (err) {
          console.error('Terminal message error:', err);
        }
      } else {
        // Stream message
        console.log('Received message:', message);
      }
    },

    close(ws: any) {
      const client = terminalClients.get(ws);

      if (client) {
        console.log('Terminal WebSocket client disconnected:', client.sessionId);
        closeTerminal(client.sessionId);
        terminalClients.delete(ws);
      } else {
        console.log('WebSocket client disconnected');
        wsClients.delete(ws);
      }
    },

    error(ws: any, error: Error) {
      const client = terminalClients.get(ws);

      if (client) {
        console.error('Terminal WebSocket error:', error);
        closeTerminal(client.sessionId);
        terminalClients.delete(ws);
      } else {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
      }
    }
  }
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket endpoint: ws://localhost:${server.port}/stream`);
console.log(`📮 POST events to: http://localhost:${server.port}/events`);
console.log(`💻 Terminal endpoint: ws://localhost:${server.port}/terminal`);