// Run as admin: same decision as `wants_admin` in src-tauri/src/lib.rs (tests/admin-cases.json checks both).
// Hand-added .exe games run as admin unless turned off; GOG games (also started from their exe) can
// opt in; Steam / Epic go through their launcher: never.

export const canAdmin = (g) => (g.source === 'pc' || g.source === 'gog') && !g.launch.includes('://') && /\.(exe|lnk|bat)$/i.test(g.launch);

/** `overrides`: user.adminGames, { id: bool } */
export const isAdmin = (g, overrides) => canAdmin(g) && (overrides?.[g.id] ?? (g.source === 'pc' && /\.exe$/i.test(g.launch)));
