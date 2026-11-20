# Ultimate : stack et état des lieux

> Vérifié dans le code le 2026-11-20 (v0.3.3). Dépôt : `github.com/Desarrh/ultimate`, licence GPL-3.0-or-later.

## 1. But et direction

Une seule bibliothèque rapide et belle pour tous les jeux PC : Steam, Epic, GOG et tout `.exe` / raccourci ajouté à la main.
Les jeux sont lancés **via leur propre launcher** (`steam://`, `com.epicgames.launcher://`), donc DRM, overlay et cloud saves restent intacts.
Direction : vitrine visuelle (la couleur suit le jeu) et suivi personnel (temps, succès, notes, Hall of Fame), avec un cœur Rust léger. Fonctionne sans compte ; Steam et Epic sont optionnels.
**Seule app de l'écosystème qui n'est pas en egui** : c'est une app Tauri (WebView2) avec un front HTML/CSS/JS.

## 2. Stack

| | |
|---|---|
| Shell | **Tauri 2** (`tauri` 2.12.5 dans Cargo.lock, feature `tray-icon`), WebView2 |
| Rust | édition 2021, toolchain stable (rustc 1.99.1 en local) |
| Crates principales | `tauri-plugin-{notification, single-instance, dialog, updater}` 2, `tokio` 1 (sync, time), `reqwest` 0.12 (rustls, json), `serde`/`serde_json`, `futures`, `winreg` 0.52, `keyring` 3 (windows-native), `windows-sys` 0.61 (UAC, processus, écran, mémoire), `@fontsource/inter` et `@fontsource/bricolage-grotesque` (polices embarquées), `image` 0.25 (jpeg/png), `base64`, `glob` |
| Front | **Vanilla JS** (ES modules, pas de framework), **Vite 6** (6.4.6), `@tauri-apps/api` 2.12.4, cible `es2021`, port dev 1420 |
| Tests | `npm test` = `node tests/fuzzy.mjs` (recherche floue, dont < 5 ms sur 2 000 jeux) + `node tests/tuning.mjs` (réglages conseillés) + `node tests/admin.mjs` (mêmes cas que le test Rust, `tests/admin-cases.json`) + `cargo test` (tests unitaires dans les modules) ; `puppeteer-core` 23 pour `tests/ui.mjs` et `tests/qol.mjs` (E2E sur l'app lancée ; `qol.mjs` exige `ULTIMATE_TEST_SANDBOX=<dossier>` : l'app refuse alors tout jeu et tout Vigie hors de ce dossier, et le test s'arrête si la variable manque ; `tests/qa-start.sh C:\Dev\Launcher\.qa` (bac à sable sous `C:\Dev`, hors de la virtualisation MSIX des AppData quand les tests sont lancés depuis l'app Claude) lance l'app de test sans jamais déranger l'utilisateur : profil `dev.local.launcher.qa`, fenêtre créée invisible et sans focus, `--hidden`, compilation en priorité basse, aucune notification, `close_stale_instances` désactivé), `tests/audit.py` (cohérence du cache) |
| API Windows | registre via `winreg` (HKCU Steam, HKLM `WOW6432Node\GOG.com\Games`, HKCU `...\CurrentVersion\Run` pour le démarrage auto), Credential Manager via `keyring`, processus via `CreateToolhelp32Snapshot` + `QueryFullProcessImageNameW` (`win.rs`, voit aussi les processus élevés), lancement en admin via `ShellExecuteExW` verbe `runas`, ouverture via `rundll32 url.dll,FileProtocolHandler` / `explorer`, `CREATE_NO_WINDOW` |
| Réseau | API Steam Web + Store (`IStoreBrowseService`, `ISteamNews`, `IPlayerService`, `ISteamUserStats`, `IWishlistService`), Epic (OAuth, GraphQL du launcher, playtime, `freeGamesPromotions`), catalogue GOG, HowLongToBeat (API non officielle avec jeton), manifeste Ludusavi (GitHub raw) |
| Dépendances externes | WebView2 Runtime, Steam / Epic Launcher / GOG pour lancer leurs jeux. Build : Rust, Node 20+, VS Build Tools C++ |
| Build | `npm install` · `npm run tauri dev` · `npm run tauri build` (installeur NSIS) · `npm test` · `npm run audit` · `npm run test:ui` |
| Release | `npm run release` lance `scripts/release.mjs` : `tauri build` signé (clé `%USERPROFILE%\.tauri\ultimate.key`), puis écrit `latest.json`. La publication GitHub reste **manuelle** |
| Exe | `src-tauri\target\release\Ultimate.exe` (~8,7 Mo) ; installeur `src-tauri\target\release\bundle\nsis\Ultimate_<v>_x64-setup.exe` (~3 Mo) + `.sig` + `latest.json` |
| CI GitHub | `.github/workflows/ci.yml` sur `windows-latest` (push `main` et PR) : `npm ci`, `npm run build`, `node tests/fuzzy.mjs && node tests/tuning.mjs && node tests/admin.mjs`, `cargo test`, `cargo build --release`. Pas de job de release |
| Profil release | `opt-level=3`, `lto=true`, `codegen-units=1`, `strip`, `panic=abort` ; en dev, dépendances en `opt-level=2` |

## 3. Architecture

**Rust (`src-tauri/src/`)**
- `main.rs` : appelle `launcher_lib::run()`, sous-système Windows en release.
- `lib.rs` : `Game`/`AppState`/`User`, les 48 commandes Tauri, lancement (admin ou non), mode jeu Vigie, suivi des sessions, tray, protocole `img://`, MAJ, démarrage auto, persistance JSON.
- `win.rs` : Win32 direct. `run_as_admin` (`ShellExecuteExW` + `runas`, refus UAC → erreur `uac-refused` ; un `.bat` passe par `cmd /c cd /d <dossier>`), `processes` / `exe_paths` (chemins de tous les processus, y compris élevés), `started` (`GetProcessTimes`), `kill_older` (ferme les autres processus du même exe, plus anciens qu'une date).
- `hw.rs` : le PC pour les réglages conseillés. Carte graphique et VRAM exacte (registre de la classe d'adaptateurs d'affichage, `HardwareInformation.qwMemorySize`, la carte avec le plus de mémoire), processeur (`ProcessorNameString`), RAM (`GlobalMemoryStatusEx`), écran principal (`EnumDisplaySettingsW`). Cache `hw.json`, nouvelle détection en arrière-plan à chaque ouverture, événement `hw` si ça change.
- `gameconf.rs` : fichiers de réglages des jeux (Cyberpunk 2077 : `UserSettings.json`). Lecture, application avec sauvegarde, restauration. N'écrit que des clés connues (`CP_KEYS`) et des valeurs que le jeu accepte : la liste `values` du fichier, les bornes min/max, ou, pour les listes que le jeu remplit au lancement (`ResolutionScaling`, `DLSS`, `VSync`, `FrameGeneration`), les couples valeur/index relevés dans des fichiers écrits par le jeu. Le reste est laissé au menu du jeu (« à régler dans le jeu »). Le format est conservé à l'octet près (indentation de 4, ordre des clés grâce à `serde_json` `preserve_order` ; un test le vérifie sur une copie du vrai fichier via `ULTIMATE_CP_SAMPLE`). En mode bac à sable, le fichier est `<bac à sable>\cp2077\UserSettings.json`.
- `vigie.rs` : pont facultatif vers Vigie. Recherche de l'exe, capacités, appel sans fenêtre avec délai et `kill`, lecture du JSON de `--etat-dev`.
- `scan.rs` : détection des bibliothèques Steam / Epic / GOG.
- `vdf.rs` : parseur VDF/ACF de Valve, fait maison.
- `meta.rs` : enrichissement Steam Store (jaquettes, hero, logo, tags vers catégories), couleur dominante (HSL), news, jeux gratuits Epic, recherche Steam, HLTB.
- `extra.rs` : amis Steam, liste de souhaits et promos, jeux gratuits Steam/GOG, captures d'écran Steam locales.
- `accounts.rs` : clé Steam et jetons Epic (Credential Manager), succès Steam/Epic avec rareté, playtime Epic.
- `img.rs` : protocole `img://` (`/t?w=&u=` distant, `/f?w=&p=` local), redimensionne sans jamais agrandir, cache disque `img-cache`.
- `saves.rs` : sauvegardes de saves à partir du manifeste Ludusavi (motifs, dossiers connus, placeholders).

**Front (`src/`, plus `index.html`)**
- `index.html` : barre du haut (sources, recherche Ctrl K, stats, amis, actualiser, gratuits, paramètres) et 4 vues `<main>` (home, game, stats, trophy).
- `main.js` (~89 Ko) : état global `S`, préférences `P`, rendu par chaînes HTML, grille virtualisée, vues, modales, raccourcis, manette, délégation d'événements via `data-act`.
- `style.css` (~40 Ko) : tout le thème.
- `i18n.js` : FR/EN avec la fonction `T(fr, en)`.
- `tuning.js` + `tuning/*.json` : réglages conseillés (U6), purs et sans réseau. Une fiche par jeu (seulement `cyberpunk2077.json` pour l'instant, sources citées dedans), une table de puissance relative des cartes (RTX 3070 Ti = 100), un repli générique pour les autres jeux.
- `fuzzy.js` : recherche floue pure (sans DOM) partagée par la barre de recherche et la palette : `prep` (nom normalisé, initiales, chiffres romains), `query`, `score`, `completion`.

**Front ↔ Rust**
- `invoke()` pour les 45 commandes (dont `vigie_status`, `dev_state`, `dev_kill`, `game_memory`, `test_mode`, `hw_info`, `game_settings`, `apply_settings`, `restore_settings`) : `get_cached`, `refresh`, `launch`, `achievements`, `sync_achievements`, `news`, `free_games`, `steam_free_games`, `gog_free_games`, `friends`, `wishlist`, `hltb`, `backup_save`, `add_custom`, `update_custom`, `remove_custom`, `steam_search`, `get_user`/`set_user`, `get_memos`/`set_memo`, `set_wallpaper`/`get_wallpaper`, `image_accent`, `check_update`/`install_update`, etc.
- Événements Rust vers front (`emit`) : `library` (bibliothèque mise à jour), `achsum`, `vigie` (`{arg, msg}` : résumé d'une ligne de Vigie, affiché en toast ; notification Windows si la fenêtre n'a pas le focus).
- Images servies par le schéma `img://` (asynchrone, `Cache-Control` 1 an).
- Capabilities : `core:default`, plein écran, `notification:default`. **CSP** stricte (`tauri.conf.json`) : scripts `'self'` seulement (aucun gestionnaire `onerror` en ligne : un écouteur global lit `data-err`), styles en ligne permis, images `self`, `img://` / `http://img.localhost`, `https:` et `data:`, IPC `ipc:` / `http://ipc.localhost`. `devCsp` ajoute le serveur Vite.

**Détection (`scan.rs`)**
- **Steam** : racine lue dans HKCU, `steamapps/libraryfolders.vdf` donne toutes les bibliothèques, puis chaque `appmanifest_*.acf` (nom, installdir, taille, `StateFlags`, qui sert à repérer une MAJ en attente). Le temps de jeu vient de `localconfig.vdf` du compte le plus récent. Les jeux joués mais non installés sont ajoutés aussi. Les runtimes (Proton, Steamworks…) sont exclus.
- **Epic** : `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests\*.item` pour les jeux installés, `Catalog\catcache.bin` (base64 → JSON) pour les jeux possédés et leurs images. Les add-ons sont filtrés via `mainGameItem`.
- **GOG** : registre HKLM `SOFTWARE\WOW6432Node\GOG.com\Games`.
- **Ajoutés à la main** : `custom.json`, avec un appid Steam associable pour récupérer les métadonnées.

**Threads**
- Runtime async Tauri/tokio pour le HTTP. `spawn_blocking` pour le scan et le calcul de couleur.
- `watch_deals` : boucle async toutes les **6 h** (notifications de gratuits et de promos).
- `watch_pc` : thread qui **toutes les 20 s** vérifie, via `win::exe_paths`, si l'exe d'un jeu ajouté à la main tourne (compte aussi le temps hors Ultimate, et marche pour un jeu lancé en admin : `sysinfo` ne lit pas le chemin d'un processus élevé).
- `track` : un thread par lancement d'un jeu installé, **Steam compris**. Il attend jusqu'à 240 s qu'un processus du dossier du jeu apparaisse (sonde toutes les 5 s), puis toutes les 15 s qu'il disparaisse. Il ajoute alors les minutes (sauf Steam et jeux ajoutés à la main, comptés ailleurs), lance la sauvegarde auto et, si le mode jeu est actif, `Vigie --apres-jeu` quand la dernière session se ferme (compteur `GAME_SESSIONS`).
- Garde-fous `busy` / `ach_busy` (Mutex) contre les rafraîchissements concurrents. `close_stale_instances` ferme les anciennes instances après une MAJ : seulement les processus du même chemin d'exe, démarrés avant sa date de modification (jamais en mode bac à sable).

## 4. Direction artistique

Défini dans `src/style.css` (variables `:root` et règles), les palettes dans `src/main.js` (`CAT`, `PALETTE`, `theme()`, `hexDeep()`), les polices dans `index.html`, la couleur de fond de fenêtre dans `tauri.conf.json` (`#0A0A0C`).

- **Thème** : sombre uniquement (`color-scheme: dark`), esthétique « glass » sur fond d'artwork flou.
- **Couleurs dynamiques** : `--a` (accent) et `--d` (fond profond) sont recalculés par jeu ou collection à partir de la couleur dominante de l'artwork (`meta::accent`). `hexDeep(a) = a × 0.12 + 6`. Transition du fond en `.6s`. Mode « fixe » possible (`P.accentFixed`).
- **Valeurs de base** : `--a #FF6B9A`, `--d #120A10`, `--muted #B8B8C0`, `--line rgba(255,255,255,.12)`, texte `#FFFFFF`, fenêtre `#0A0A0C`, erreur `#FF9A9A`.
- **Surfaces** : `.glass` = `rgba(10,10,14,.55)` + `blur(18px)` + bordure `--line`. `.solid` = `rgba(18,18,24,.97)` + `blur(24px)` + ombre `0 24px 60px rgba(0,0,0,.6)`. Placeholders d'image `#1A1A20` / `#111`.
- **Sémantique** : favori `#FFD45C`, coup de cœur `#FF8000`, noté / étoiles `#00E054`, installé / 100 % `#6EE7A8`, gratuit / promo `#4ADE80` (texte `#062010`), MAJ `#FFB020`, Hall of Fame `#F5C84C` sur `#140F04`, stats `#7C9CFF`, Steam `#5B9DFF`, Epic `#E6E6EA`, GOG `#C97CF0`.
- **Palette des collections perso** : `#FF6B9A #5B9DFF #3EE6A8 #FFB020 #C97CF0 #FF6B6B #2DD4BF #F5C84C`. Chaque catégorie automatique a sa couleur (`CAT`, environ 35 entrées).
- **Polices** : **Bricolage Grotesque** 600/800 pour les titres (h1 64 px, ou 80 px en mode grand ; h2 30 px ; nom du jeu 40 px ; KPI 28 px ; letter-spacing −.03em). **Inter** 400 à 700 pour le texte (14 px de base, 13 px méta, 11 px labels en capitales espacées .1–.14em). Chargées depuis Google Fonts, repli `system-ui`.
- **Arrondis** : pilules (barre de sources 24, recherche 48 px de haut → 24, boutons icône 44 px → 22, bouton Jouer 60 px → 30), cartes de collection 22, bandeau Reprendre et modales 24, jaquettes 14 (ratio 2/3), boîtes et toasts 16 et 26, inputs 12, badges 6 à 11, scrollbar 5.
- **Espacements** : marges de page 56 px (barre du haut 18/32), grille `minmax(150px)` (S 118, M 150, L 200, +50 en mode grand), gap 24 × 20, actions 8, en-têtes 14 à 28.
- **Icônes** : SVG inline façon Lucide (trait 2–2,2, `stroke-linecap: round`, 18 px), aucune police d'icônes.
- **Animations** : jaquette au survol `translateY(-6px)` + ombre teintée à l'accent (.25s) ; carte de collection −4px ; Jouer −2px puis `pulse` au lancement ; zoom 1.03 du hero (.6s) ; `spin` 1s sur actualiser ; interrupteurs .2s. Les jeux non installés sont désaturés (`brightness .5 saturate .55`). Focus : `outline 3px var(--a)`.
- **Options** : `nomotion` coupe toutes les animations, `noglass` retire le flou, `big` sert au mode TV / manette, taille des jaquettes S/M/L, fond d'écran (auto, jeu ou fichier, flou et assombrissement).

## 5. Conventions

- **Raccourcis clavier** : `Ctrl+K` palette (jeux et commandes, raccourcis affichés), `Ctrl+F` recherche, `F5` actualiser, `Ctrl+,` paramètres, `Échap` retour, `Entrée` valide une nouvelle collection, `Ctrl+Entrée` enregistre un mémo. **Manette** (API Gamepad, navigation spatiale) : croix ou stick pour se déplacer (répétition 160 ms), A = clic, B = retour, Y = palette, Start = mode grand.
- **Recherche** : floue (`fuzzy.js`), accents et casse ignorés, initiales (« bg3 », « gta5 »), mots dans le désordre, 1 à 2 fautes. Résultats triés par pertinence. Complétion en ligne avec le meilleur résultat (Tab, → ou Fin l'accepte), Entrée lance le 1er résultat. Environ 1 ms par frappe pour 2 000 jeux.
- **Données** : `%APPDATA%\dev.local.launcher\` (identifiant Tauri `dev.local.launcher`). On y trouve `library.json`, `user.json`, `memos.json`, `tracked.json`, `achsum.json`, `history.json`, `custom.json`, `hltb.json`, le manifeste Ludusavi et `img-cache\`. Écriture atomique (`.tmp` puis rename).
- **Préférences d'affichage** : `localStorage['prefs']` du WebView (`wp`, `wpBlur`, `wpDim`, `big`, `accentMode`, `size`, `glass`, `motion`). Les réglages métier vont dans `user.json` (collections, favoris, masqués, `close_to_tray`, `autostart`, `notify`, `auto_backup`, `backup_dir`, notes, `update_url`, `lang`, défaut `en`, `game_mode` et `dev_guard` (vrai par défaut), `vigie_path`, `admin_games` : surcharge par jeu du lancement en admin, `tuning` : curseur et cible par jeu). Cache du matériel : `hw.json`.
- **Secrets** : clé Steam et jetons Epic dans le Gestionnaire d'identification Windows, jamais sur disque.
- **Sauvegardes** : `%USERPROFILE%\Documents\...` par défaut, ou `backup_dir`.
- **Mises à jour auto** : `tauri-plugin-updater` avec signature minisign (clé publique dans `tauri.conf.json`). Endpoint par défaut `https://github.com/Desarrh/ultimate/releases/latest/download/latest.json`, surchargeable par `update_url`. Vérification au démarrage, une pastille dans la barre du haut, installation NSIS `passive`.
- **Installation** : installeur NSIS par utilisateur. Instance unique (une 2e instance ramène la fenêtre). Fermer la fenêtre la réduit dans le tray (par défaut). `--hidden` démarre caché (pour le démarrage auto via la clé `Run`).
- **Format du code** : commentaires en anglais, UI bilingue FR/EN, identifiants de jeu préfixés `steam:` / `epic:` / `gog:` / `pc:`.

## 6. Fonctionnalités actuelles

- Bibliothèque unifiée (installés et possédés) avec filtre par plateforme, grille virtualisée ou vue liste.
- Recherche par sous-chaîne sur le nom, les tags et les mémos.
- Tris : récent, heures, succès obtenus, note, % de complétion, A–Z…
- Collections automatiques à partir des tags Steam (Souls-like, Survie, Roguelite, Coop…), collections perso colorées, favoris, jeux masqués.
- Page jeu : couleur dynamique, logo et hero, Jouer, dossier, captures Steam locales, news officielles, durées HowLongToBeat, mémo « où j'en suis », note en demi-étoiles, coup de cœur, critique.
- Succès Steam et Epic (rareté, dates), vue liste « à la Steam », **Hall of Fame** des jeux finis à 100 %.
- Temps de jeu Steam, Epic et mesuré par Ultimate (jeux non-Steam, même lancés hors de l'app).
- Bandeau « Reprendre », KPI (temps, succès).
- Stats : totaux, top jeux, genres, plateformes, historique quotidien, série de jours.
- Jeux gratuits de la semaine (Epic, Steam, GOG), promos de la liste de souhaits Steam, notifications Windows.
- Amis Steam : qui est en ligne et à quoi il joue.
- Sauvegarde des saves (manuelle, ou auto après une session).
- Ajout de jeux à la main (`.exe`, `.lnk`, `.url`, `.bat`) avec association à une fiche Steam. Les `.exe` ajoutés se lancent **en admin par défaut** (UAC, bouclier sur Jouer). Une empreinte (taille + date) est prise à l'ajout : si l'exe a changé, Ultimate demande confirmation avant de l'élever, puis retient la nouvelle empreinte ; option par jeu dans le menu du jeu ou la palette, aussi proposée pour les jeux GOG (lancés par leur exe). Steam et Epic passent par leur launcher : jamais en admin. Ultimate lui-même reste sans droits. Un refus UAC donne un simple toast.
- **Mode jeu Vigie** (facultatif) : au lancement, `Vigie --avant-jeu` détaché, jamais attendu, résumé en toast ; `--apres-jeu` à la fin de la dernière session, Steam compris.
- **Garde-fou dev** (facultatif) : si `Vigie --etat-dev` signale des serveurs de dev, Docker ou WSL, carte non bloquante « Tout couper / Garder » ; sans réponse, le jeu part après 2 s. L'état est préchargé au survol de Jouer, à l'ouverture de la fiche ou de la palette (cache 20 s, 5 s après un échec) ; au clic, on attend au plus 350 ms, sinon on lance sans demander. On ne demande pas pour WSL seul sous 2 Go (souvent allumé). En build de dev, le serveur vite d'Ultimate (projet `C:\Dev\Launcher`) est retiré de la liste et « Tout couper » ne coupe alors que Docker et WSL (`--couper-dev --docker --wsl`).
- **Réglages conseillés** (onglet « Réglages » de la page jeu) : le PC détecté, un curseur Performance → Qualité (5 crans), une cible d'images/s (jusqu'à la fréquence de l'écran), un verdict (atteignable avec marge, juste, hors de portée ; processeur limitant) et, pour Cyberpunk 2077, chaque réglage avec sa valeur actuelle (lue dans `UserSettings.json`, en lecture seule), la valeur conseillée et le pourquoi, avec la source (DF, HUB, PC Gamer, OC3D). Les autres jeux ont des conseils génériques. Aucun chiffre d'images/s n'est affiché : le modèle interne ne sert qu'à classer les options. Le choix du curseur et de la cible est gardé par jeu (`user.json`, `tuning`). **Appliquer** écrit les valeurs conseillées (écriture atomique). Au premier essai seulement, une copie exacte du fichier est créée à côté de lui, `UserSettings.json.avant-ultimate.bak`, jamais écrasée. **Remettre ma config d'avant Ultimate** la recopie (elle reste sur le disque). Les deux sont refusés tant que `Cyberpunk2077.exe` tourne (le jeu réécrit le fichier en quittant). Les autres `.bak` (par exemple `.avant-optimisation.bak`) ne sont jamais touchés.
- **Mémoire manquante** : sous Jouer, « Il te manque 1,4 Go pour ce jeu · Tout couper », d'après `Vigie --memoire-jeu <exe>` (pic de RAM connu du jeu), préchargé avec l'état dev. Jeux ajoutés à la main : leur exe ; jeux Steam, Epic et GOG : leur dossier d'installation (Vigie y prend le plus gros pic connu, marqueur `memoire-jeu-dossier`) ; rien si Vigie est absent, ancien ou ne connaît pas le jeu.
- **Palette Ctrl+K** : jeux (récents si vide) et commandes, recherche floue, raccourcis affichés, Entrée lance, Maj+Entrée ouvre la fiche.
- Tray, démarrage avec Windows, mode manette ou TV, MAJ en un clic, FR/EN.

## 7. Intégrations avec les autres apps de `C:\Dev`

| App | Point de connexion concret |
|---|---|
| **vigie** (egui, gestionnaire de tâches + chasseur de RAM) | **Fait** (`vigie.rs`). Exe cherché dans `vigie_path` (réglage), puis `C:\Dev\vigie\dist\Vigie.exe`, puis à côté d'Ultimate. Appels sans fenêtre (`CREATE_NO_WINDOW`), stdout lu dans un thread, délai puis `kill` : `--avant-jeu` (45 s) et `--apres-jeu` (30 s) pour le mode jeu, `--etat-dev` (1,5 s, une ligne JSON `{"v":1,"items":[{kind,label,pids,ram_mo}],"total_mo":n}`) et `--couper-dev` (60 s) pour le garde-fou. Un ancien Vigie ouvrirait sa fenêtre sur un drapeau inconnu : les deux drapeaux dev ne sont passés que si l'exe les déclare dans sa ressource de version (`VigieCli` = « avant-jeu apres-jeu etat-dev couper-dev », lu une fois par date de modification). Vigie absent, ancien, lent ou en échec : rien ne s'affiche, l'option est grisée dans les paramètres. |
| **explorateur** (egui, explorateur de fichiers) | Les boutons « Dossier du jeu », « Sauvegardes » et « Captures » ouvrent aujourd'hui `explorer`. Les remplacer par `C:\Dev\explorateur\...\Explorateur.exe <chemin>` quand il existe (Vigie fait déjà ce test), avec repli sur `explorer`. |
| **lecteur-universel** (egui, visionneuse et convertisseur) | Ouvrir les captures d'écran et les clips (dossier Steam `screenshots`) dans le Lecteur plutôt que dans la lightbox, pour le recadrage, la conversion en GIF/MP4 et le glisser vers Discord. Ouvrir aussi les mémos ou un `notes.md` par jeu dans son éditeur. |
| **tube** (egui, client YouTube) | Onglet ou bouton « Guides et vidéos » sur la page jeu, qui lance Tube sur une recherche « <nom du jeu> walkthrough / guide / patch ». Les vidéos des trailers et des news Steam s'ouvriraient aussi dans Tube. Il faudrait que Tube accepte une URL ou une recherche en argument : le README parle du collage d'un lien, pas d'un argument CLI. À vérifier ou ajouter. |
| Commun | Les 4 apps egui partagent un thème (crème / bleu nuit) et des composants communs. Ultimate a sa propre DA sombre et dynamique, c'est assumé, mais on pourrait au moins harmoniser l'icône, les raccourcis (`Ctrl+K` = palette partout) et l'auto-MAJ GitHub. |

## 8. Limites connues / dette technique

- `main.js` et `lib.rs` sont monolithiques. Le rendu passe par des chaînes HTML (risque XSS limité par `esc()` et par la CSP).
- Préférences coupées en deux (`localStorage` contre `user.json`) : pas d'export ou de sauvegarde unique.
- Temps de jeu Steam non mesuré par Ultimate (on fait confiance à `localconfig.vdf` / l'API), même si la fin des sessions Steam est maintenant détectée. La détection passe par du polling (`win::exe_paths`) toutes les 15 à 20 s, avec un abandon à 240 s si le jeu démarre lentement (le mode jeu est alors rendu). Un jeu dont l'exe est hors de son dossier d'installation n'est pas suivi.
- Lancement en admin : le dialogue UAC s'affiche à chaque lancement (voulu : Ultimate ne s'élève jamais). `sysinfo` ne sert plus qu'à `close_stale_instances`.
- Dépendances fragiles : HowLongToBeat (API privée, jeton), endpoint et clientId Epic, scraping `steamcommunity.com`, format de `catcache.bin`.
- Locale magasin figée **FR / EUR** (`cc=FR`, `locale=fr`) même quand l'UI est en anglais.
- `tauri.conf.json` : `endpoints: []` (l'URL de MAJ est codée en dur dans `lib.rs`), identifiant `dev.local.launcher` hérité.
- Release manuelle, sans job CI. `tests/ui.mjs` demande l'app lancée et n'est pas dans la CI. D'anciens installeurs s'accumulent dans `bundle/nsis`.
- `Mutex::lock().unwrap()` partout : un panic empoisonne l'état, et `panic=abort` en release.
- GOG : uniquement le registre (pas de jeux possédés non installés, pas de temps GOG Galaxy).

## 9. Pistes QoL

Classées par utilité pour un profil dev + jeu + YouTube. **(a)** = idée inédite, **(b)** = existe ailleurs (Playnite, Steam, GOG Galaxy…) mais manque à Ultimate. Effort S/M/L. Règle : chaque piste doit rester instantanée.

| # | Piste | Type | Effort | Comment elle reste instantanée |
|---|---|---|---|---|
| 1 | ✅ **Mode jeu Vigie en un clic** : Jouer lance `Vigie --avant-jeu` en parallèle, puis `--apres-jeu` à la fermeture. Toast « 2,3 Go libérés » | (a) | S | Process détaché, jamais attendu. Le jeu part immédiatement et le résumé stdout arrive après coup |
| 2 | **Palette de lancement globale** : raccourci système (ex. `Win+Alt+G`) qui ouvre une petite fenêtre au-dessus de tout, on tape 2 lettres, Entrée, le jeu se lance. Pas besoin de passer par la fenêtre principale | (a) | M | App déjà en mémoire dans le tray. Liste déjà dans `AppState`, filtrée côté JS (< 1 ms pour quelques centaines de jeux) |
| 3 | ✅ **Recherche fuzzy + autocomplétion** : tolère les fautes et les initiales (« er » → Elden Ring, « bg3 »), ignore les accents, complète en ligne, Entrée lance le 1er résultat | (b) | S | Index normalisé précalculé à chaque événement `library`. Score par sous-séquence en JS pur, pas d'aller-retour Rust |
| 4 | **Reprendre là où j'en étais, avec contexte** : au survol de Jouer, afficher le mémo, la dernière session (« il y a 3 j, 1 h 40 ») et la dernière news de patch depuis cette date | (a) | S | Toutes les données sont déjà en cache (`memos`, `history`, `news`). Aucun réseau au survol |
| 5 | **Guides YouTube dans Tube** : bouton « Guide » sur la page jeu ; si on est bloqué (mémo contenant « bloqué » / « boss »), il propose directement « <jeu> <boss> guide » | (a) | M | Simple `spawn` de Tube avec la requête, rien n'est chargé dans Ultimate |
| 6 | ✅ **Garde-fou dev avant de jouer** : au lancement, si des serveurs de dev, Docker ou WSL tournent (info Vigie), proposer « Tout couper » ou « Garder ». Le soir, plus d'oubli de `npm run dev` qui mange 4 Go | (a) | M | Vigie est déjà en mémoire, la requête est locale. Popup non bloquante, le jeu est lancé quand même après 2 s sans réponse |
| 7 | **Lancement direct sans launcher** pour Epic et GOG quand c'est possible (exe du manifeste, comme Playnite / Heroic), avec repli sur l'URI officielle | (b) | M | On évite les 5 à 15 s de démarrage du launcher Epic. Chemin connu grâce au `.item` déjà lu |
| 8 | **Raccourcis clavier complets** (en partie fait : palette, `Ctrl+F`, `F5`, `Ctrl+,`) : flèches et Entrée dans la grille hors manette, `F5` actualiser, `Ctrl+1..4` vues, `F` favori, `/` recherche, `Ctrl+L` dernier jeu joué | (b) | S | Gestion d'événements pure. La navigation spatiale de la manette existe déjà et se réutilise |
| 9 | ✅ (polices) **Polices et premier rendu hors ligne** : embarquer Inter et Bricolage en `woff2`, afficher `library.json` avant tout appel réseau | (b) | S | Plus de dépendance à Google Fonts : premier écran stable, pas de flash de police |
| 10 | **Sessions chronométrées** : « Je joue 1 h » au lancement, notification douce à 55 min, mémo proposé à la fermeture (« où tu en es ? ») | (a) | S | Timer dans le thread `track` existant. Le prompt du mémo s'ouvre à la fermeture du jeu, jamais pendant |
| 11 | **Pages jeu préchargées au survol** : news, HLTB, succès chargés après 300 ms de survol d'une jaquette (comme le préchargement de Tube) | (a) | S | Requêtes en arrière-plan, mises en cache. Le clic affiche une page déjà prête |
| 12 | **Ouvrir dans Explorateur / Lecteur** : dossier du jeu, saves et captures dans les apps maison, plus un bouton « Clip → GIF » vers le Lecteur | (a) | S | `spawn` d'un exe local, repli sur `explorer` |
| 13 | **Vrai temps Steam en direct** : étendre `track` aux jeux Steam pour une « session en cours » dans le tray et l'historique quotidien exact | (b) | M | Même sonde `sysinfo` (15 s), rien sur le chemin du lancement |
| 14 | **Bibliothèque GOG Galaxy complète** : lire la base `galaxy-2.0.db` (jeux possédés, temps), comme le fait Playnite | (b) | M | Lecture SQLite locale pendant le scan déjà asynchrone, cache dans `library.json` |
| 15 | **Mini-widget « ce soir »** dans le tray : 3 jeux suggérés selon le temps libre annoncé (HLTB restant, dernière session, mémo) | (a) | L | Calcul local sur des données en cache, aucune requête à l'ouverture du menu |
