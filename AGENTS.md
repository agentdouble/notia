# AGENTS.MD

Objectif : faire évoluer l’app **rapidement** sans dette technique, sans casser l’existant, et avec une qualité **production**.

---

## Règles d’or (non négociables)

1) **No artifacts**
- Ne pas créer de fichiers/artefacts inutiles (scripts temporaires, dumps, docs redondantes, etc.).
- Si un fichier est ajouté, il doit avoir une utilité durable.

2) **Less code > more code**
- Préférer une solution simple, lisible, et minimale.
- Supprimer le code mort plutôt que le contourner.

3) **Rewrite > add**
- Réécrire/améliorer les composants existants plutôt que d’en créer de nouveaux.
- Ajouter un nouveau composant uniquement si cela **réduit** la complexité globale.

4) **Flag obsolete**
- Si un fichier devient obsolète : le **signaler** et proposer sa suppression.
- Garder une codebase légère.

5) **Avoid race conditions at all costs**
- Pas d’effets de bord concurrents, pas de double requêtes silencieuses, pas de state incohérent.
- Toujours gérer : annulation (abort), idempotence, retries, locks si nécessaire.

6) **Comments only if necessary**
- Commenter uniquement ce qui n’est pas évident (why > what).
- Aucun commentaire “bruit”.

7) **Modulaire & collaboratif**
- Découper en modules clairs (responsabilités nettes).
- Une feature ne doit **jamais** casser le reste du système.
- Préférer des interfaces stables, des contrats explicites.

8) **Meaningful logs (value only)**
- Ajouter des logs seulement s’ils aident à diagnostiquer en prod.
- Logs structurés quand pertinent (contexte, ids, timing, erreurs).
- Pas de spam.

9) **Think production-first**
- Chaque changement doit être “ship-ready”.
- Gestion d’erreurs propre, timeouts, validations, fallback si nécessaire.
- Pas de “TODO” oubliés, pas de hacks temporaires.

10) **README.md toujours à jour**
- Toute modif fonctionnelle/architecture/config doit être reflétée dans le README.

---

## Stack & conventions projet

### Python (Backend)
- **Toujours utiliser `uv`** pour la gestion des packages et l’exécution.
- Pas de dépendances inutiles.

---

## Workflow de dev (obligatoire)

1) **Toujours lancer l’app via `start.sh`**
- `start.sh` démarre backend + frontend.
- Les ports sont définis dans `.env`
- CORS : configuration dynamique via ce mécanisme (ne pas hardcoder des ports).

2) **Si besoin de travailler avec DB : utiliser MCP SUPABASE**
3) **Travail avec un workflow git propre**
4) **Tests unitaires systématiques avant commit.**
5) **Toujours tester avec MCP chrome-devtool l'implémentation** 
- Use MCP et test la feature end to end. 

7) **Avant de conclure une PR / livraison**
- Nettoyer les fichiers inutiles.
- Mettre à jour le README si nécessaire.

---

## Patterns recommandés

### Prévenir les race conditions (front)
- AbortController sur fetch
- Cleanup sur useEffect
- “Latest request wins” si plusieurs appels possibles
- Déduplication / caching si utile

### Prévenir les race conditions (back)
- Endpoints idempotents quand possible
- Transactions DB si écritures multiples
- Verrous logiques uniquement si nécessaire
- Timeouts + retries contrôlés

---

## Learnings

- IA: retirer la ligne `/generate` puis insérer la suggestion uniquement si la version du contenu n'a pas changé.
- Menu slash: mesurer la position du curseur via `Text` (onTextLayout) + offset de scroll pour ancrer le menu.
- Menu slash: fermer via tap/Echap sans réouverture immédiate tant que le contenu ne change pas.
- IA streaming: diffuser en SSE + aperçu en UI sans modifier le contenu, annuler dès que le contenu change.
- Notes: désactiver le bouton de suppression pendant la requête et réinitialiser la sélection si la note active est supprimée.
