// Copia o build UMD do supabase-js (versão travada no package.json) para
// vendor/, assim o app não carrega scripts de CDN de terceiros (CSP 'self').
import { copyFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8'));
copyFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'vendor/supabase.js');
console.log('vendor/supabase.js <- @supabase/supabase-js@' + pkg.version);
