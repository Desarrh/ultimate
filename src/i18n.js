// Languages: English by default, French available. Static French texts are translated in the DOM;
// dynamic ones (dates, counts) go through T(fr, en) in main.js.

export const LANG = (() => { try { return localStorage.getItem('lang') || 'en'; } catch { return 'en'; } })();
export const LOCALE = LANG === 'en' ? 'en-US' : 'fr-FR';
export const T = (fr, en) => (LANG === 'en' ? en : fr);
export const dec = (x, d = 1) => (Number.isInteger(+x) ? String(x) : (+x).toFixed(d).replace('.', LANG === 'en' ? '.' : ','));
export function setLang(l) { try { localStorage.setItem('lang', l); } catch { /* ignore */ } location.reload(); }

// French (as written in the UI) -> English
const EN = {
  // navigation & home
  Tout: 'All', Bibliothèque: 'Library', Rechercher: 'Search', 'Tous les jeux': 'All games', Collections: 'Collections', '+ Collection': '+ Collection',
  '+ Jeu': '+ Game', 'Bons plans': 'Deals', 'TEMPS DE JEU': 'PLAYTIME', SUCCÈS: 'ACHIEVEMENTS', 'SUCCÈS ›': 'ACHIEVEMENTS ›', '100 %': '100%',
  'Relier →': 'Connect →', 'Analyse…': 'Scanning…', 'Aucun jeu ne correspond.': 'No match.', 'Aucun jeu détecté.': 'No games found.',
  Jouer: 'Play', Installer: 'Install', Dossier: 'Folder', 'Mettre à jour': 'Update', GRATUIT: 'FREE', 'DÉJÀ À TOI': 'OWNED', Récupérer: 'Claim',
  'EPIC · BIENTÔT': 'EPIC · SOON', '—': '—',
  // collections & tags
  Favoris: 'Favorites', Installés: 'Installed', 'Mises à jour': 'Updates', Apps: 'Apps', 'Avec mémo': 'With notes', 'Démos & tests': 'Demos & tests',
  Masqués: 'Hidden', 'Coups de cœur': 'Loved', Notés: 'Rated', Survie: 'Survival', 'Souls-like': 'Souls-like', Roguelite: 'Roguelite',
  Metroidvania: 'Metroidvania', Horreur: 'Horror', Coop: 'Co-op', Multijoueur: 'Multiplayer', Solo: 'Single-player', RPG: 'RPG', Chill: 'Chill',
  Incrémental: 'Idle', Puzzle: 'Puzzle', Plateformes: 'Platformer', 'Monde ouvert': 'Open world', Construction: 'Building', Stratégie: 'Strategy',
  Simulation: 'Simulation', Tir: 'Shooter', Course: 'Racing', Rythme: 'Rhythm', Aventure: 'Adventure', Action: 'Action', Démo: 'Demo', Logiciel: 'Apps',
  // sorting
  'TRIER PAR': 'SORT BY', 'Trier :': 'Sort:', 'Joués récemment': 'Recently played', 'Temps de jeu': 'Playtime', 'Ma note': 'My rating',
  'Complétion des succès': 'Achievement progress', Alphabétique: 'A–Z', 'Taille sur disque': 'Size on disk', AFFICHER: 'SHOW',
  'Afficher les apps': 'Show apps', 'Masquer les apps': 'Hide apps', 'Supprimer la collection': 'Delete collection',
  // game page
  'NON INSTALLÉ': 'NOT INSTALLED', 'MISE À JOUR DISPONIBLE': 'UPDATE AVAILABLE', 'DERNIÈRE SESSION': 'LAST PLAYED', TAILLE: 'SIZE',
  'Non installé': 'Not installed', MÉMO: 'NOTES', Modifier: 'Edit', 'Lire →': 'Read →', 'POUR FINIR': 'TIME TO BEAT', Histoire: 'Story',
  '+ Extras': '+ Extras', 'EN JEU EN CE MOMENT': 'PLAYING NOW', Succès: 'Achievements', Actus: 'News', Captures: 'Screenshots', 'Mon avis': 'Review',
  Mémo: 'Notes', Tous: 'All', Obtenus: 'Unlocked', 'À faire': 'Locked', Rares: 'Rarest', Débloqué: 'Unlocked', Verrouillé: 'Locked',
  'Aucune actu.': 'No news.', 'Aucune capture (F12 en jeu).': 'No screenshots (F12 in game).', 'Steam uniquement.': 'Steam only.',
  'Aucun succès.': 'No achievements.', 'Rien dans ce filtre.': 'Nothing here.', 'Lire en entier ↗': 'Read more ↗', Enregistrer: 'Save',
  Enregistré: 'Saved', Effacé: 'Cleared', 'Non enregistré': 'Unsaved', 'Écris quelque chose…': 'Write something…', Avis: 'Review',
  'Voir la collection →': 'See collection →', 'Coup de cœur': 'Love', Paramètres: 'Settings', 'Options du jeu': 'Game options',
  // menus
  COLLECTIONS: 'COLLECTIONS', '+ Nouvelle': '+ New', Favori: 'Favorite', 'Retirer des favoris': 'Unfavorite', Noter: 'Rate', 'Modifier…': 'Edit…',
  Sauvegarder: 'Back up saves', Gérer: 'Manage', 'Vérifier les fichiers': 'Verify files', 'Désinstaller…': 'Uninstall…', 'Ouvrir Epic': 'Open Epic',
  'Voir dans Steam': 'Open in Steam', 'Page Steam': 'Steam page', Masquer: 'Hide', Afficher: 'Show', 'Retirer de la bibliothèque': 'Remove from library',
  Recharger: 'Reload', 'AMIS STEAM': 'STEAM FRIENDS', 'En ligne': 'Online', 'Aucun ami visible (liste privée ?).': 'No friends visible (private list?).',
  'Ajoute ta clé Steam dans les Paramètres.': 'Add your Steam key in Settings.',
  // stats
  Statistiques: 'Stats', TOTAL: 'TOTAL', '2 DERNIÈRES SEMAINES': 'LAST 2 WEEKS', SÉRIE: 'STREAK', 'Top 12': 'Top 12', '30 derniers jours': 'Last 30 days',
  'Ces 2 semaines': 'Last 2 weeks', 'Par genre': 'By genre', 'Par plateforme': 'By platform', 'Mes notes': 'My ratings', 'Dès demain.': 'From tomorrow.',
  // settings
  Général: 'General', Langue: 'Language', 'Garder en fond à la fermeture': 'Keep running when closed', 'Lancer avec Windows': 'Start with Windows',
  Notifications: 'Notifications', 'Mode manette': 'Controller mode', Vérifier: 'Check', Apparence: 'Appearance', Accent: 'Accent', Auto: 'Auto',
  Fixe: 'Fixed', Jaquettes: 'Covers', Fond: 'Background', Image: 'Image', Jeu: 'Game', 'Choisir…': 'Choose…', Retirer: 'Remove', Flou: 'Blur',
  Sombre: 'Dim', 'Flou des panneaux': 'Panel blur', Animations: 'Animations', Sauvegardes: 'Save backups', 'Après chaque session': 'After each session',
  Ouvrir: 'Open', 'Retirer la clé': 'Remove key', 'Clé API': 'API key', 'Obtenir une clé ↗': 'Get a key ↗', '· domaine : localhost · profil public': '· domain: localhost · public profile',
  Déconnecter: 'Disconnect', 'Connexion ↗': 'Sign in ↗', OK: 'OK', Fermer: 'Close', 'Ultimate est à jour.': 'Ultimate is up to date.',
  // dialogs
  'Nouvelle collection': 'New collection', Nom: 'Name', Créer: 'Create', Annuler: 'Cancel', 'Donne un nom à la collection.': 'Name the collection.',
  'Cette collection existe déjà.': 'This collection already exists.', 'Modifier le jeu': 'Edit game', 'Jeu Steam associé': 'Linked Steam game',
  Chercher: 'Search', Aucun: 'None', 'Aucun résultat.': 'No results.',
  // toasts & backend messages
  Ajouté: 'Added', Créée: 'Created', 'Sauvegarde…': 'Backing up…', 'Installation…': 'Installing…', Affiché: 'Shown', Masqué: 'Hidden',
  'Ajouté aux favoris': 'Added to favorites', 'Retiré des favoris': 'Removed from favorites', 'Steam relié': 'Steam connected', 'Manette détectée': 'Controller detected',
  'Jeu retiré': 'Game removed', 'Téléchargement de la mise à jour…': 'Downloading update…', '…': '…',
  'Ce jeu n\'a pas de succès Steam.': 'No Steam achievements.', 'Ce jeu n\'a pas de succès Epic.': 'No Epic achievements.',
  'Pas de succès disponibles pour ce jeu.': 'No achievements.', "Ajoute ta clé d'API Steam dans les Paramètres pour voir tes succès.": 'Add your Steam key in Settings.',
  'Connecte ton compte Epic (Paramètres) pour voir les succès débloqués.': 'Connect Epic in Settings.',
  'Steam ne renvoie pas tes succès : passe les « détails de jeu » de ton profil en public.': 'Steam hides your achievements: set game details to public.',
  'Une clé Steam fait 32 caractères (chiffres et lettres A-F).': 'A Steam key is 32 characters (0-9, A-F).', 'Steam refuse cette clé, ou ton profil est privé.': 'Key rejected, or profile is private.',
  'Code invalide : copie la valeur « authorizationCode ».': 'Invalid code: copy the authorizationCode value.', 'Aucun fichier de sauvegarde trouvé sur ce PC.': 'No save files found.',
  'Jeu introuvable': 'Game not found', ORDRE: 'ORDER', Décroissant: 'Descending', Croissant: 'Ascending', 'Inclure les apps': 'Include apps', 'Afficher plus': 'Show more', Panthéon: 'Hall of Fame', 'Croissant ↑': 'Ascending ↑', 'Décroissant ↓': 'Descending ↓', 'Succès obtenus': 'Achievements unlocked', 'Clé Steam requise (Paramètres).': 'Steam key required (Settings).', 'Connecte Epic (Paramètres).': 'Connect Epic (Settings).',
  'Profil Steam privé (Détails de jeu → Public).': 'Private Steam profile (Game details → Public).', 'À jour': 'Up to date', 'jeux': 'games', 'installés': 'installed', 'HowLongToBeat injoignable': 'HowLongToBeat unreachable', 'Déjà à jour': 'Already up to date',
};

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
const ATTRS = ['placeholder', 'aria-label', 'title'];
const tr = (s) => {
  const k = s.trim();
  if (!k) return null;
  const v = EN[k];
  return v === undefined ? null : s.replace(k, v);
};
function walk(node) {
  if (node.nodeType === 3) {
    const el = node.parentElement;
    if (!el || SKIP.has(el.tagName) || el.closest('[data-notr], .nm, .ph, .gname, .title, .hn, .dt b, .mini b, .free-item .t, .fr, .fitem b, .hit, option')) return;
    const t = tr(node.nodeValue);
    if (t !== null && t !== node.nodeValue) node.nodeValue = t;
    return;
  }
  if (node.nodeType !== 1) return;
  attrs(node);
  if (SKIP.has(node.tagName)) return;
  for (const c of node.childNodes) walk(c);
}
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) { const t = tr(v); if (t !== null && t !== v) el.setAttribute(a, t); }
  }
}
export function startI18n() {
  document.documentElement.lang = LANG;
  if (LANG !== 'en') return;
  walk(document.body);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
