# WorkTime V1

Application personnelle de suivi du temps de travail.

## Règles intégrées

- 8h de travail effectif par jour.
- 30 minutes de pause minimum obligatoires.
- Départ prévu = arrivée + 8h + max(30 min, pauses réelles).
- L'heure d'arrivée se pointe en un clic.
- L'heure d'arrivée peut être corrigée manuellement.
- Les pauses peuvent être commencées et terminées depuis le bouton dédié.
- Les calculs utilisent des timestamps : fermer l'interface pendant une pause ne casse pas le compteur.

## 1. Extension Chrome (PC)

1. Décompresse ce dossier.
2. Ouvre `chrome://extensions`.
3. Active **Mode développeur**.
4. Clique **Charger l'extension non empaquetée**.
5. Sélectionne le dossier `extension`.
6. Épingle WorkTime dans la barre Chrome.

Les données sont stockées dans `chrome.storage.local`.

## 2. PWA mobile / iPhone

Le dossier `pwa` doit être servi en HTTPS (GitHub Pages convient).

En local pour tester :
- démarre un petit serveur HTTP depuis le dossier du projet, par exemple `python -m http.server 8080`,
- puis ouvre `http://localhost:8080/pwa/` sur l'ordinateur.

Pour l'iPhone :
1. publier le contenu en HTTPS ;
2. ouvrir l'URL dans Safari ;
3. Partager → **Sur l'écran d'accueil** ;
4. ouvrir ensuite WorkTime depuis l'icône.

Après le premier chargement complet, le service worker met l'interface en cache afin qu'elle puisse fonctionner hors connexion.

Les journées sont stockées dans IndexedDB sur le téléphone.

## 3. Synchronisation

La V1 livrée ici est volontairement **local-first** et ne dépend pas d'Internet.

Le dossier `supabase/schema.sql` prépare les tables sécurisées pour la future synchronisation :
- `work_days`
- `work_pauses`

La prochaine étape sera de brancher une authentification Supabase et une file de synchronisation :
- modifications locales marquées `pending`;
- push vers Supabase quand Internet revient ;
- pull des modifications plus récentes ;
- résolution simple des conflits par `updated_at`.

Ainsi, même après ajout de la synchro, l'application continuera à fonctionner hors ligne.

## Politique de stockage ajoutée

- Les 90 derniers jours gardent les détails complets des pauses.
- Après 90 jours, chaque journée est convertie en résumé compact.
- Après 365 jours, l'historique est supprimé automatiquement.
- Le nettoyage se lance au démarrage et peut aussi être déclenché manuellement.
- La PWA affiche une estimation de la taille locale et permet :
  - l'export JSON ;
  - le nettoyage manuel ;
  - l'effacement complet des données locales.
- L'extension Chrome affiche aussi la taille locale et permet export + nettoyage.

Le compteur à l'écran est recalculé à partir des timestamps et n'est jamais enregistré chaque seconde.

## Ajout rapide des pauses (v1.2)

Deux méthodes sont maintenant disponibles en plus du chronomètre normal :

- boutons `+5`, `+10`, `+15`, `+30` minutes ;
- champ **Pause totale aujourd'hui** : saisir directement une valeur comme `46`.

Si des pauses ont déjà été pointées avec début/fin, WorkTime les conserve.
Le total manuel ne peut pas être inférieur au temps déjà pointé.

Exemple :
- arrivée : 08:56 ;
- pause totale saisie : 46 min ;
- pause obligatoire : 30 min ;
- pause supplémentaire : 16 min ;
- départ prévu : 17:42.

## Interface sophistiquée (v1.3)

- Nouveau time picker heure/minute pour corriger l'arrivée.
- Ajout manuel d'une pause par plage horaire : début + fin.
- Mode alternatif : définir directement la pause totale de la journée.
- Boutons rapides +5 / +10 / +15 / +30.
- Résumé séparé : pause obligatoire / pause supplémentaire.
- Barre de progression de la journée.
- Interface harmonisée entre la PWA mobile et l'extension Chrome.
- Le fonctionnement offline, l'historique compact et la politique de stockage restent inchangés.

## Clarification des pauses (v1.4)

- Affichage explicite de la **pause totale**.
- La pause obligatoire est affichée comme partie incluse du total (`30 / 30 min ✓`).
- Les minutes supplémentaires sont séparées clairement.
- Ajout du **temps restant à travailler** dans le résumé principal.
- Ajout d'un mini rappel de l'heure de départ dans le résumé PWA.
- Aucun changement de formule : arrivée + 8h + pause totale réelle (minimum 30 min).
