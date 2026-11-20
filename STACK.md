# Ultimate — stack technique

> Vérifié dans le code le 2026-11-20 (v0.3.3, après la revue EGM). Dépôt : `github.com/Desarrh/ultimate`, licence GPL-3.0-or-later. Règles communes : [DIRECTION.md](../DIRECTION.md).

## 1. But et direction

Une bibliothèque unique pour les jeux PC : Steam, Epic, GOG, et tout `.exe` ou raccourci ajouté à la main.
Steam et Epic sont lancés par leur launcher (`steam://`, `com.epicgames.launcher://`) : DRM, overlay et sauvegardes cloud restent intacts. Les jeux GOG et ceux ajoutés à la main sont lancés par leur exe.
Direction : une page par jeu dont la couleur suit l'artwork, et un suivi personnel (temps de jeu, succès, notes, Panthéon des jeux finis à 100 %). Fonctionne sans compte ; Steam et Epic sont facultatifs.

**Écarts assumés aux règles de DIRECTION.md** (à faire valider par l'utilisateur s'ils changent) :

| Règle | Écart | Raison |
|---|---|---|
| Apps en egui | Tauri 2 (WebView2) + HTML/CSS/JS | Thème « verre » sur l'artwork flouté, accent recalculé par jeu et grille d'images animée ; exception validée dans DIRECTION.md (§3 et §6.3) |
| Un exe portable, sans installateur | Installeur NSIS par utilisateur | La mise à jour signée de Tauri (`tauri-plugin-updater`) passe par un installeur sous Windows |
| Sans droits admin par défaut | Les `.exe` ajoutés à la main se lancent en admin | Demande de l'utilisateur (certains jeux l'exigent). Ultimate lui-même ne s'élève jamais |
| Commentaires en français | Commentaires du code en anglais | Dépôt public ; l'interface est bilingue |
| Réglages dans `%APPDATA%\<App>\settings.json`, caches dans `%LOCALAPPDATA%\<App>\` | Tout dans `%APPDATA%\dev.local.launcher\` (réglages dans `user.json`, `img-cache`, `hw.json`, manifeste Ludusavi) | Identifiant Tauri hérité ; déplacer les données demanderait une migration (§9) |
| `crash.log` au plantage | Absent | À faire (§9, piste 13) |
| Fenêtre utilisable en moins de 300 ms, CPU à ~0 % au repos | Non mesurés (la recherche et les réglages conseillés le sont, §2) | À mesurer |

## 2. Stack et mesures

| Domaine | Choix |
|---|---|
| Shell | **Tauri 2** (`tauri` 2.12.5, feature `tray-icon`), WebView2 |
| Rust | édition 2021, toolchain stable (rustc 1.99.1 en local) |
| Crates | `tauri-plugin-{notification, single-instance, dialog, updater}` 2, `tokio` 1 (sync, time), `reqwest` 0.12 (rustls, json), `serde`, `serde_json` (`preserve_order`), `futures`, `winreg` 0.52, `keyring` 3 (windows-native), `windows-sys` 0.61 (UAC, processus, écran, mémoire), `image` 0.25 (jpeg, png), `base64`, `glob` |
| Front | JS sans framework (modules ES), **Vite 6**, `@tauri-apps/api` 2, cible `es2021`, port de dev 1420. Polices embarquées : `@fontsource/inter` (400 à 700) et `@fontsource/bricolage-grotesque` (600, 800), sous-ensemble latin, woff2 |
| API Windows | Registre (`winreg`), Gestionnaire d'identification (`keyring`), processus (`CreateToolhelp32Snapshot`, `QueryFullProcessImageNameW`, `GetProcessTimes`), élévation (`ShellExecuteExW` verbe `runas`), ouverture (`rundll32 url.dll,FileProtocolHandler`, `explorer`) |
| Réseau | Steam Web API (`IStoreBrowseService`, `ISteamNews`, `IPlayerService`, `ISteamUser`, `ISteamUserStats`, `IWishlistService`), recherche du Store, page communauté `steamcommunity.com` (scraping), Epic (OAuth, GraphQL, temps de jeu, `freeGamesPromotions`), catalogue GOG, HowLongToBeat (API privée avec jeton), manifeste Ludusavi (GitHub) |
| Dépendances à l'exécution | WebView2 Runtime ; Steam, Epic ou GOG pour lancer leurs jeux. Vigie : facultatif (§7) |
| Build | `npm install`, `npm run tauri dev`, `npm run tauri build` (installeur NSIS), `npm test`, `npm run audit`, `npm run test:ui` |
| Release | `npm run release` (`scripts/release.mjs`) : build signé avec `%USERPROFILE%\.tauri\ultimate.key`, puis `latest.json`. Publication sur GitHub à la main (`gh release create`) |
| Profil release | `opt-level=3`, `lto`, `codegen-units=1`, `strip`, `panic=abort` ; en dev, dépendances en `opt-level=2` |
| CI GitHub | `.github/workflows/ci.yml`, `windows-latest`, à chaque push sur `main` et PR : `npm ci`, `npm run build`, tests JS, `cargo test`, `cargo build --release`. Pas de job de release |

**Mesures** (PC de l'utilisateur, 2026-11-20) :

| | Valeur |
|---|---|
| `Ultimate.exe` | 9,2 Mo ; installeur 3,3 Mo |
| RAM au repos, dans la zone de notification | 282 Mo privés en tout (7 processus) : 12 Mo pour `Ultimate.exe`, le reste pour WebView2. Ensemble de travail : 422 Mo |
| Recherche | environ 1 ms par frappe pour 2 000 jeux (`tests/fuzzy.mjs`) |
| Réglages conseillés | 0,04 ms par calcul, environ 12 ms pour redessiner l'onglet |

## 3. Architecture

### Rust (`src-tauri/src/`)

| Fichier | Rôle |
|---|---|
| `main.rs` | Appelle `launcher_lib::run()` ; sous-système Windows en release |
| `lib.rs` | Types `Game`, `AppState`, `User` ; les commandes Tauri ; lancement (admin ou non) ; mode jeu ; suivi des sessions ; tray ; protocole `img://` ; mise à jour d'Ultimate ; démarrage avec Windows ; lecture et écriture des fichiers JSON |
| `win.rs` | Win32 direct : `run_as_admin` (refus UAC → erreur `uac-refused` ; un `.bat` passe par `cmd /c cd /d <dossier>`), `processes` et `exe_paths` (voient aussi les processus élevés), `started`, `kill_older` |
| `hw.rs` | Le PC pour les réglages conseillés : carte graphique et mémoire vidéo (registre des adaptateurs d'affichage), processeur, RAM, mode de l'écran principal. Cache `hw.json`, nouvelle détection en arrière-plan, événement `hw` si quelque chose change |
| `gameconf.rs` | Fichier de réglages de Cyberpunk 2077 (`UserSettings.json`) : lecture, application, restauration (détail au §6) |
| `vigie.rs` | Pont facultatif vers Vigie : recherche de l'exe, capacités, appel sans fenêtre avec délai (§7) |
| `scan.rs` | Détection des bibliothèques Steam, Epic, GOG |
| `vdf.rs` | Lecteur des fichiers VDF/ACF de Valve |
| `meta.rs` | Données du Store Steam (jaquettes, hero, logo, tags → catégories), couleur dominante, news, jeux gratuits Epic, recherche Steam, HowLongToBeat |
| `extra.rs` | Amis Steam, liste de souhaits et promos, jeux gratuits Steam et GOG, captures d'écran Steam locales |
| `accounts.rs` | Clé Steam et jetons Epic (Gestionnaire d'identification), jeux Steam possédés, succès Steam et Epic avec rareté, temps de jeu Epic |
| `img.rs` | Protocole `img://` : `/t?w=&u=` (image distante), `/f?w=&p=` (fichier local). Réduit à la largeur affichée (jamais agrandi) et garde un cache disque `img-cache`. Les gif, webp et bmp (non décodés) sont servis tels quels, sans cache |
| `saves.rs` | Copie des fichiers de sauvegarde des jeux, d'après le manifeste Ludusavi |

### Front (`src/`, plus `index.html`)

| Fichier | Rôle |
|---|---|
| `index.html` | Barre du haut (plateformes, recherche, stats, amis, actualiser, gratuits, paramètres) et 4 vues (accueil, page jeu, stats, Panthéon) |
| `main.js` | État `S`, préférences d'affichage `P`, rendu par chaînes HTML, grille virtualisée, vues, fenêtres, raccourcis, manette, actions par `data-act` |
| `style.css` | Tout le thème (source de vérité du §4) |
| `i18n.js` | Français et anglais, fonction `T(fr, en)` ; traduit aussi les textes français du DOM |
| `fuzzy.js` | Recherche floue sans DOM : `prep`, `query`, `score`, `completion` |
| `tuning.js`, `tuning/*.json` | Réglages conseillés : fiche par jeu (seulement `cyberpunk2077.json`, sources citées dedans), tables de puissance des cartes (RTX 3070 Ti = 100) et des processeurs (i9-9900K = 100), conseils génériques |
| `admin.js` | Décision « lancer en admin » côté interface. Copie volontaire de `wants_admin` (`lib.rs`) : les deux sont testés sur les mêmes cas (`tests/admin-cases.json`) |

### Front ↔ Rust

- `invoke()` vers les commandes de `lib.rs` (liste dans `generate_handler!`). `test_mode` ne sert qu'aux tests.
- Événements Rust → front : `library` (bibliothèque modifiée), `achsum` (nombre de succès par jeu), `hw` (PC détecté), `vigie` (`{arg, msg}`, résumé d'une ligne de Vigie, affiché en toast ; notification Windows si la fenêtre n'a pas le focus).
- Images par `img://` (`http://img.localhost/` dans WebView2), `Cache-Control` d'un an.
- Capabilities : `core:default`, plein écran, `notification:default`.
- **CSP** (`tauri.conf.json`) : `default-src 'self'`, `script-src 'self'` (aucun gestionnaire `onerror` en ligne : un écouteur global lit `data-err`), `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `img-src 'self' data: blob: http://img.localhost img: https:`, `connect-src 'self' ipc: http://ipc.localhost`, `object-src 'none'`, `base-uri 'self'`. `devCsp` ajoute le serveur Vite.

### Détection (`scan.rs`)

- **Steam** : racine lue dans HKCU ; `steamapps/libraryfolders.vdf` donne les bibliothèques, puis chaque `appmanifest_*.acf` (nom, dossier, taille, `StateFlags` pour une mise à jour du jeu en attente). Le temps de jeu vient de `localconfig.vdf` du compte le plus récent. Les jeux joués mais désinstallés sont gardés ; les outils (Proton, Steamworks…) sont exclus.
- **Epic** : `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests\*.item` (installés), `Catalog\catcache.bin` (possédés, images). Les extensions sont filtrées par `mainGameItem`.
- **GOG** : registre HKLM `SOFTWARE\WOW6432Node\GOG.com\Games` (installés seulement).
- **Ajoutés à la main** : `custom.json` (nom, chemin, fiche Steam associée, empreinte de l'exe).

### Threads et suivi des sessions

- Runtime async Tauri/tokio pour le réseau ; `spawn_blocking` pour le scan, les couleurs, l'élévation et Vigie.
- `watch_deals` : toutes les 6 h, notifications de jeux gratuits et de promos.
- `watch_pc` : toutes les 20 s, regarde si l'exe d'un jeu ajouté à la main tourne. Il compte le temps, même si le jeu a été lancé hors d'Ultimate, et lance la sauvegarde auto à la fin.
- `track` : un thread par lancement depuis Ultimate d'un jeu installé, Steam compris. Il attend jusqu'à 240 s (sonde toutes les 5 s) qu'un processus du dossier du jeu apparaisse, puis vérifie toutes les 15 s qu'il tourne encore. À la fin : minutes ajoutées (sauf Steam et jeux ajoutés à la main, comptés ailleurs), sauvegarde auto, et `--apres-jeu` si c'était la dernière session.
- Verrous `busy` et `ach_busy` contre deux rafraîchissements en même temps.
- `close_stale_instances` : au démarrage, ferme les autres processus du même exe démarrés avant sa date de modification (ancienne version restée dans le tray après une mise à jour). Jamais en mode test.

**Ce qui est suivi, selon le jeu :**

| Jeu | Temps mesuré par Ultimate | Session (`track`) et mode jeu | Sauvegarde auto |
|---|---|---|---|
| Steam lancé depuis Ultimate | non (Steam le compte) | oui | oui |
| Epic, GOG lancés depuis Ultimate | oui | oui | oui |
| Epic, GOG lancés ailleurs | non | non | non |
| `.exe` ajouté à la main (d'où qu'il soit lancé) | oui (`watch_pc`) | oui depuis Ultimate | oui (`watch_pc`) |
| `.lnk`, `.url`, `.bat` ajoutés à la main | non | non | non |

Un jeu dont le processus tourne hors de son dossier d'installation n'est pas vu ; un `.exe` qui n'est qu'un lanceur (il démarre le vrai jeu puis se ferme) compte presque 0 minute.

## 4. Direction artistique

Source de vérité : `src/style.css` (variables `:root`), et dans `src/main.js` les couleurs (`CAT`, `PALETTE`, `theme()`, `hexDeep()`). Fond de fenêtre `#0A0A0C` dans `tauri.conf.json`.

- **Thème** : sombre uniquement (`color-scheme: dark`), panneaux translucides floutés (`.glass`) sur l'artwork flouté.
- **Couleurs dynamiques** : `--a` (accent) et `--d` (fond profond) suivent la couleur dominante de l'artwork du jeu ou de la collection (`meta::accent`). `hexDeep` calcule chaque canal RVB comme `canal × 0,12 + 6`. Transition du fond en 0,6 s. Accent fixe possible (`P.accentMode = 'fixed'`, couleur `P.accentFixed`).
- **Valeurs de base** : `--a #FF6B9A`, `--d #120A10`, `--muted #B8B8C0`, `--line rgba(255,255,255,.12)`, texte `#FFFFFF`, erreur `#FF9A9A`.
- **Surfaces** : `.glass` = `rgba(10,10,14,.55)` + flou 18 px + bordure `--line` ; `.solid` = `rgba(18,18,24,.97)` + flou 24 px + ombre `0 24px 60px rgba(0,0,0,.6)`.
- **Couleurs de sens** : favori `#FFD45C`, coup de cœur `#FF8000`, note `#00E054`, installé et 100 % `#6EE7A8`, gratuit `#4ADE80`, mise à jour `#FFB020`, Panthéon `#F5C84C` sur `#140F04`, stats `#7C9CFF`, Steam `#5B9DFF`, Epic `#E6E6EA`, GOG `#C97CF0`.
- **Collections** : palette perso `#FF6B9A #5B9DFF #3EE6A8 #FFB020 #C97CF0 #FF6B6B #2DD4BF #F5C84C` ; 32 catégories automatiques avec leur couleur (`CAT`).
- **Polices** : Bricolage Grotesque 600 et 800 pour les titres (h1 64 px, ou 80 px en mode TV, interlettrage −0,03 em ; titre de la page jeu 64 px ; h2 30 px), Inter 400 à 700 pour le texte (14 px, méta 13 px, libellés 11 px en capitales espacées). Embarquées ; repli `system-ui`.
- **Formes** : pilules (barre des plateformes, recherche 48 px de haut, boutons ronds 44 px, Jouer 60 px), cartes de collection 22 px, bandeau Reprendre et fenêtres 24 px, jaquettes 14 px (ratio 2/3), champs 12 px.
- **Mouvement** : jaquette survolée −6 px avec une ombre à la couleur du jeu ; Jouer −2 px puis `pulse` au lancement ; image du bandeau Reprendre agrandie à 1,03 au survol ; jeux non installés désaturés. Focus : contour 3 px `--a`.
- **Options d'affichage** : animations coupées (`nomotion`), sans flou (`noglass`), mode TV (`big`), taille des jaquettes S/M/L, fond (auto, jeu ou image ; flou et assombrissement).

## 5. Conventions

- **Raccourcis** : `Ctrl+K` palette de commandes, `F1` la même palette (liste de toutes les commandes et de leurs raccourcis), `Ctrl+F` recherche, `F5` actualiser, `Ctrl+,` paramètres, `Échap` retour, `Ctrl+Entrée` enregistre un mémo. Manette : croix ou stick (répétition 160 ms), A = clic, B = retour, Y = palette de commandes, Start = mode TV.
- **Données** : `%APPDATA%\dev.local.launcher\` (identifiant Tauri) : `library.json`, `user.json`, `memos.json`, `tracked.json`, `achsum.json`, `history.json`, `custom.json`, `hltb.json`, `hw.json`, `ludusavi-manifest.yaml`, `wallpaper-<date>.jpg`, `img-cache\`. Écriture atomique (fichier temporaire écrit sur disque, puis renommé). Un fichier illisible est mis de côté (`<nom>.illisible-<date>`) au lieu d'être écrasé.
- **`user.json`** (clés en camelCase) : `collections`, `favorites`, `hidden`, `ratings` (notes et critiques), `closeToTray`, `autostart`, `notify`, `autoBackup`, `backupDir`, `updateUrl`, `lang` (défaut `en`), `gameMode` et `devGuard` (vrai par défaut), `vigiePath`, `adminGames` (lancement en admin choisi par jeu), `adminFp` (empreintes des jeux GOG élevés), `tuning` (curseur et cible par jeu), `seenFree` et `seenDeals` (notifications déjà faites).
- **Préférences d'affichage** : `localStorage['prefs']` du WebView (`wp`, `wpGame`, `wpBlur`, `wpDim`, `big`, `accentMode`, `accentFixed`, `size`, `glass`, `motion`).
- **Secrets** : clé Steam et jetons Epic dans le Gestionnaire d'identification, jamais sur disque.
- **Mise à jour d'Ultimate** : `tauri-plugin-updater`, signature minisign (clé publique dans `tauri.conf.json`). Source : `https://github.com/Desarrh/ultimate/releases/latest/download/latest.json`, ou `updateUrl`. Pastille dans la barre du haut, installation NSIS `passive`. Refusée pendant une partie suivie ou pendant qu'un `.exe` ajouté à la main tourne (sa session serait perdue). Vérification au démarrage puis toutes les 24 h.
- **Installation** : installeur NSIS par utilisateur dans `%LOCALAPPDATA%\Ultimate`. Instance unique. Fermer la fenêtre la garde dans la zone de notification (tray). `--hidden` démarre sans fenêtre (démarrage avec Windows, clé `Run`).
- **Code** : identifiants de jeu `steam:`, `epic:`, `gog:`, `pc:` ; interface en français et anglais.

## 6. Fonctionnalités

- Bibliothèque des jeux installés et possédés, filtre par plateforme, grille ou liste ; tris (récent, temps de jeu, succès, note, complétion, A–Z, taille).
- **Recherche floue** sur le nom, puis les tags et les mémos : casse et accents ignorés, initiales (« bg3 », « gta5 »), mots dans le désordre, une ou deux fautes. Le meilleur résultat complète la saisie (Tab, → ou Fin l'accepte) ; Entrée le lance.
- **Palette de commandes** (`Ctrl+K`) : jeux (récents si la saisie est vide) et commandes, avec leur raccourci. Entrée lance, Maj+Entrée ouvre la page jeu.
- Collections automatiques (tags Steam), collections perso colorées, favoris, jeux masqués.
- Page jeu : couleur du jeu, logo et hero, Jouer, dossier, captures Steam, news, durées HowLongToBeat, mémo, note en demi-étoiles, coup de cœur, critique, onglet Réglages.
- Succès Steam et Epic (rareté, dates), Panthéon des jeux finis à 100 %. Stats : totaux, top, genres, plateformes, historique quotidien, série.
- Jeux gratuits de la semaine (Epic, Steam, GOG), promos de la liste de souhaits Steam, amis Steam en ligne.
- Copie des sauvegardes de jeu (manuelle, ou automatique après une session) dans `<Documents>\Ultimate - Sauvegardes\<jeu>\<date>`, dix copies gardées par jeu. Le dossier Documents réel est lu dans le registre (suit OneDrive).
- **Jeux ajoutés à la main** (`.exe`, `.lnk`, `.url`, `.bat`), associables à une fiche Steam.
- **Lancement en admin** : par défaut pour les `.exe` ajoutés (invite UAC, bouclier sur Jouer), réglable par jeu, proposé aussi pour GOG. Une empreinte (taille et date du fichier lancé ; pour un `.lnk` ou un `.bat`, celle du raccourci ou du script, pas de sa cible) est prise à l'ajout (au premier lancement en admin pour GOG). Si elle a changé, Ultimate demande confirmation avant d'élever. Un refus UAC affiche un toast.
- **Mode jeu** (avec Vigie) : `--avant-jeu` au lancement, `--apres-jeu` quand la dernière session vue se termine. Une session dont le jeu n'a jamais été vu (240 s) ne déclenche pas `--apres-jeu`, pour ne pas réveiller les apps en pleine partie. La palette propose en permanence « Rendre le mode jeu maintenant » pour en sortir à la main.
- **Garde-fou dev** (avec Vigie) : si des serveurs de dev, Docker ou WSL tournent, un encart « Tout couper / Garder » s'affiche ; sans réponse, le jeu part après 2 s. L'état est chargé à l'avance (survol de Jouer, ouverture de la page, palette) et gardé 20 s ; au clic, Ultimate attend au plus 350 ms, sinon il lance sans demander. WSL seul ne déclenche pas l'encart sous 2 Go. En build de dev, le serveur Vite d'Ultimate est retiré de la liste et « Tout couper » n'arrête que Docker et WSL.
- **Mémoire manquante** (avec Vigie) : sous Jouer, « Il te manque 1,4 Go pour ce jeu », avec « Tout couper » quand le garde-fou a quelque chose à couper.
- **Réglages conseillés** (onglet Réglages) : PC détecté, curseur Performance → Qualité (5 crans), cible d'images/s (jusqu'à la fréquence de l'écran), verdict (atteignable avec marge, juste, hors de portée ; processeur limitant). Pour Cyberpunk 2077 : chaque réglage avec sa valeur actuelle, la valeur conseillée, la raison et sa source. Aucun chiffre d'images/s n'est affiché. Autres jeux : conseils généraux.
  - **Appliquer** n'écrit que les clés connues, avec des valeurs que le jeu accepte. Le reste s'affiche « à régler dans le jeu ».
  - Au premier Appliquer, une copie exacte du fichier est faite à côté : `UserSettings.json.avant-ultimate.bak`, jamais écrasée. **Remettre ma config d'avant Ultimate** la recopie.
  - Les deux sont refusés tant que `Cyberpunk2077.exe` tourne (le jeu réécrit le fichier en quittant). Avant d'écrire, Ultimate vérifie qu'il sait reproduire le fichier à l'octet près ; sinon (nouvelle version du jeu, autre format), il n'écrit rien.
- Tray, démarrage avec Windows, mode TV et manette, mise à jour en un clic, français et anglais.

## 7. Intégrations

### Vigie (`vigie.rs`)

Vigie (`C:\Dev\vigie`, egui) est le gestionnaire de tâches maison. Ultimate fonctionne sans lui : absent, ancien, lent ou en échec, rien ne s'affiche et les options sont grisées.

- **Recherche** : `vigiePath` (réglage), puis `C:\Dev\vigie\dist\Vigie.exe`, puis le dossier d'Ultimate. Seul un fichier `Vigie.exe` portant le marqueur `VigieCli` est exécuté (`C:\Dev` est inscriptible par tout compte local).
- **Capacités** : la ressource de version `VigieCli` liste les commandes comprises (lue une fois par date de modification). `--avant-jeu` et `--apres-jeu` sont envoyés à tout Vigie marqué (tous les Vigie distribués les connaissent) ; les autres drapeaux seulement s'ils figurent dans la liste, car un Vigie qui ne les connaît pas ouvrirait sa fenêtre.
- **Appel** : sans fenêtre, sortie lue par un canal, délai puis arrêt du processus.

| Commande | Délai | Sortie | Usage |
|---|---|---|---|
| `--avant-jeu` | 45 s | une ligne de texte | mode jeu, au lancement |
| `--apres-jeu` | 30 s | une ligne de texte | fin de la dernière session vue, ou palette |
| `--etat-dev` | 1,5 s | `{"v":1,"items":[{"kind","label","pids","ram_mo","ports","projet"}],"total_mo"}` | garde-fou ; `projet` sert à exclure le serveur Vite d'Ultimate en dev |
| `--couper-dev` [`--docker` `--wsl`] | 60 s | une ligne de texte | « Tout couper » ; Vigie choisit lui-même ce qu'il arrête |
| `--memoire-jeu <exe ou dossier>` | 1,5 s | `{"v":1,"connu","nom","exe","chemin","pic_mo","disponible_mo","manque_mo"}` | mémoire manquante ; un dossier seulement si `VigieCli` contient `memoire-jeu-dossier` |

Le schéma de ces sorties appartient à Vigie (voir son README, section « Ligne de commande »).

### Autres apps

Aucune autre intégration n'est faite. Les idées (explorateur, lecteur, Tube) sont au §11.

## 8. Décisions et alternatives écartées

| Décision | Alternative écartée | Raison |
|---|---|---|
| Lancer Steam et Epic par leur launcher | Lancer l'exe directement | Garde DRM, overlay, sauvegardes cloud |
| Suivre les sessions par sondage des processus (5 à 20 s) | Attendre la fin du processus (`WaitForSingleObject`), événements WMI ou ETW | Simple, et suit aussi les jeux qui changent de processus (lanceur interne puis jeu). Au repos, seul `watch_pc` se réveille (toutes les 20 s, relit `custom.json`, ne liste les processus que s'il y a des jeux ajoutés à la main). À revoir si la mesure du CPU au repos le demande |
| Admin par défaut pour les `.exe` ajoutés | Élévation seulement quand Windows l'exige (`ERROR_ELEVATION_REQUIRED`) | Demande de l'utilisateur ; certains jeux fonctionnent mal sans admin sans le signaler |
| Empreinte taille + date avant l'élévation | Hash SHA-256 | Pas de lecture de centaines de Mo avant chaque lancement |
| Capacités de Vigie lues dans sa ressource de version | Un appel `--capacites` | Un ancien Vigie ouvrirait sa fenêtre sur un drapeau inconnu |
| Client OAuth du launcher Epic | Aucun compte Epic | Seul moyen d'obtenir succès et temps de jeu Epic |
| Rendu par chaînes HTML et `esc()` | Gabarit qui échappe par défaut, ou framework | Simple et rapide ; la CSP bloque les scripts en ligne |

## 9. Limites connues

| Limite | Effet | État |
|---|---|---|
| Sessions gardées en mémoire | Fermer Ultimate ou un plantage pendant une partie perd les minutes, `--apres-jeu` et la sauvegarde auto | Mise à jour refusée pendant une partie ; le reste est accepté |
| `panic=abort` et `lock().unwrap()` | Un panic, même dans un thread de fond, ferme l'app sans `crash.log` (convention de DIRECTION §4) | À faire |
| Préférences en deux endroits (`localStorage` et `user.json`) | Pas d'export unique | Accepté |
| Sources non officielles (HowLongToBeat, client Epic, scraping `steamcommunity.com`, format de `catcache.bin`) | Peuvent casser sans préavis ; la fonction concernée affiche alors un message ou rien | Accepté |
| Magasin figé FR / EUR (`cc=FR`) | Prix en euros même en anglais | À faire (région Windows) |
| `endpoints: []` dans `tauri.conf.json` | L'URL de mise à jour est dans `lib.rs` | Accepté |
| Identifiant `dev.local.launcher` hérité | Nom de dossier peu clair | Accepté (le changer déplace les données) |
| `img-cache` sans plafond | Grossit avec le nombre de jeux | À faire |
| GOG : registre seulement | Ni jeux possédés non installés ni temps GOG Galaxy | Voir §11, piste 10 |
| Tests de bout en bout hors CI (`ui.mjs`, `qol.mjs`, `coldstart.mjs`) | Demandent l'app lancée | Accepté |
| Langue en deux endroits | `localStorage['lang']` pilote l'interface ; `user.json` (`lang`) en est une copie pour les textes côté Rust | Accepté |

## 10. Tests

| Commande | Contenu |
|---|---|
| `npm test` | `tests/fuzzy.mjs` (recherche, vitesse), `tests/tuning.mjs` (réglages conseillés), `tests/admin.mjs` (cas de `tests/admin-cases.json`, aussi vérifiés par Rust), puis `cargo test` (tests dans chaque module) |
| `node tests/qol.mjs <captures> <calls.log>` | De bout en bout sur l'app lancée : recherche, palette, garde-fou, mode jeu, réglages conseillés, mémoire manquante |
| `npm run test:ui` | De bout en bout : parcours de l'interface (`tests/ui.mjs`) |
| `node tests/coldstart.mjs` | Démarrage à froid : au plus une reconstruction de la page par seconde |
| `npm run audit` | Cohérence du cache (`tests/audit.py`) |

**Mode test** : avec la variable `ULTIMATE_TEST_SANDBOX=<dossier>`, Ultimate ne lance aucun jeu et n'appelle aucun Vigie hors de ce dossier, n'envoie aucune notification et ne ferme aucune autre instance. Le fichier de Cyberpunk utilisé est `<dossier>\cp2077\UserSettings.json`. `tests/qol.mjs` s'arrête si ce mode n'est pas actif.

**Lancer l'app de test** : `tests/qa-start.sh C:\Dev\Launcher\.qa` construit le faux jeu et le faux Vigie (`tests/fakes`), puis lance une instance séparée (profil `dev.local.launcher.qa`) sans fenêtre visible ni focus, compilée en priorité basse. Le dossier de test est sous `C:\Dev` : depuis l'app Claude, les nouveaux fichiers écrits dans AppData vont dans un cache de paquet invisible pour l'utilisateur (virtualisation MSIX). Une instance neuve par passage.

## 11. Pistes

Une piste ne doit ajouter aucune attente sur le clic (lancement ou affichage sous 100 ms, aucune requête réseau bloquante). **(a)** = absente de Playnite, Steam et GOG Galaxy à notre connaissance ; **(b)** = présente dans au moins l'un d'eux.

| # | Piste | Type | Effort | Pourquoi elle n'ajoute pas d'attente |
|---|---|---|---|---|
| 1 | **Palette de lancement globale** : un raccourci système ouvre une petite fenêtre au-dessus de tout ; deux lettres, Entrée, le jeu part | (a) | M | App déjà en mémoire ; liste filtrée en JS |
| 2 | **Reprendre avec contexte** : au survol de Jouer, le mémo, la dernière session et la dernière news de patch | (a) | S | Données déjà en cache |
| 3 | **Guides dans Tube** : bouton « Guide » sur la page jeu | (a) | M | Lancement de Tube avec la requête ; Tube doit accepter une recherche en argument |
| 4 | **Lancement direct Epic** sans son launcher (exe du manifeste), avec repli sur l'URI | (b) | M | Évite 5 à 15 s de démarrage du launcher |
| 5 | **Raccourcis restants** : flèches et Entrée dans la grille, `F` favori, `/` recherche, `Ctrl+L` dernier jeu | (b) | S | Événements clavier |
| 6 | **Sessions chronométrées** : « Je joue 1 h », notification Windows sans son à 55 min, mémo proposé à la fin | (a) | S | Minuterie dans `track` |
| 7 | **Pages jeu préchargées** après 300 ms de survol d'une jaquette | (a) | S | Requêtes en arrière-plan |
| 8 | **Ouvrir dans Explorateur / Lecteur** : dossier, sauvegardes, captures ; « Clip → GIF » | (a) | S | Lancement d'un exe local, repli sur `explorer` |
| 9 | **Temps Steam en direct** : session en cours dans le tray et historique quotidien exact | (b) | S | `track` suit déjà Steam ; il reste l'affichage |
| 10 | **GOG Galaxy complet** : base `galaxy-2.0.db` (jeux possédés, temps) | (b) | M | Lecture locale pendant le scan |
| 11 | **Ce soir** : 3 jeux suggérés dans le tray selon le temps libre | (a) | L | Calcul local sur le cache |
| 12 | **Région du magasin** déduite de Windows (`GetUserGeoID`) | (b) | S | Réglage lu au démarrage |
| 13 | **`crash.log`** : hook de panic qui écrit la trace avant l'arrêt | (b) | S | Rien sur le chemin du clic |
