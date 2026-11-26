const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const env = require("./env");

// Read validated credentials
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY;

// Validate credentials
if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase credentials");
}

// Create Supabase client (provide ws transport for Node.js 20 compatibility)
const supabase = createClient(
    supabaseUrl,
    supabaseKey,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        },
        realtime: {
            transport: WebSocket
        }
    }
);

// Export Supabase client
module.exports = supabase;
