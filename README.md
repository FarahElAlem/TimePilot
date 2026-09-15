# TimePilot

Application personnelle de suivi du temps de travail, pensée pour fonctionner en **local-first** sur ordinateur et mobile.

## Fonctionnement

- 8h de travail effectif par jour.
- 30 minutes de pause minimum obligatoires.
- Départ prévu = arrivée + 8h + max(30 min, pauses réelles).
- L'heure d'arrivée se pointe en un clic et peut être corrigée manuellement.
- Les pauses peuvent être pointées, ajoutées rapidement (+5 / +10 / +15 / +30) ou saisies manuellement par période ou par durée.
- Chaque pause est conservée séparément et peut être modifiée ou supprimée.
- Les calculs utilisent des timestamps : fermer l'interface pendant une pause ne casse pas le compteur.

## Extension Chrome

1. Ouvre `chrome://extensions`.
2. Active **Mode développeur**.
3. Clique **Charger l'extension non empaquetée**.
4. Sélectionne le dossier `extension`.
5. Épingle **TimePilot** dans la barre Chrome.

Les données sont stockées dans `chrome.storage.local`.

## PWA mobile / iPhone

Le dossier `pwa` est déployé avec GitHub Pages.

Pour l'iPhone :
1. ouvrir l'URL dans Safari ;
2. Partager → **Sur l'écran d'accueil** ;
3. ouvrir ensuite TimePilot depuis l'icône.

Après le premier chargement complet, le service worker met l'interface en cache afin qu'elle puisse fonctionner hors connexion.

Les journées sont stockées dans IndexedDB sur le téléphone.

## Stockage

- Les 90 derniers jours gardent les détails complets des pauses.
- Après 90 jours, chaque journée est convertie en résumé compact.
- Après 365 jours, l'historique est supprimé automatiquement.
- Le compteur est recalculé à partir des timestamps et n'est jamais enregistré chaque seconde.
- Export JSON et nettoyage manuel disponibles.

## Synchronisation

La version actuelle est volontairement **local-first** et ne dépend pas d'Internet.

Le dossier `supabase/schema.sql` prépare les tables sécurisées pour une future synchronisation téléphone ↔ ordinateur :
- `work_days`
- `work_pauses`

La synchronisation pourra fonctionner avec une file locale `pending`, push/pull lorsque la connexion revient et résolution simple des conflits via `updated_at`.

## Version actuelle — v1.5

- Gestion des pauses sous forme de liste détaillée.
- Ajout d'une pause par **durée** ou par **période**.
- Les nouvelles pauses s'ajoutent au total existant au lieu de le remplacer.
- Modification et suppression individuelles des pauses.
- Possibilité d'annuler une pause en cours.
- Protection contre le chevauchement de périodes de pause.
- Recalcul automatique du total des pauses, du temps travaillé et de l'heure de départ.
- Fonctionnement PWA/offline et extension Chrome conservé.
