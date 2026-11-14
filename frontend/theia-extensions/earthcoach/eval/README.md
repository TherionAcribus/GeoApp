# Evaluation manuelle du comportement LLM d'EarthCoach

Harnais **opt-in** pour verifier le comportement reel d'un modele face aux prompts EarthCoach : refus de donner les reponses en mode coach, extraction des questions du proprietaire, capture structuree du dossier terrain, ancrage des reponses sur les observations fournies, badge de mode et langue de reponse.

Il n'est **jamais** branche a `npm test` ni aux builds : il se lance a la main, contre un endpoint OpenAI-compatible local.

## Principe

- `scenarios.ts` reconstruit les vrais messages avec les builders de production (`buildEarthCoachSystemPrompt`, `buildEarthCoachPrompt`) et les vrais schemas de tools (`ToolRequest` -> format OpenAI `function`).
- `run-eval.ts` joue la conversation : appels de tools dispatches en local (aucune requete reseau pour les tools; `earthcoach_calculate` execute le vrai calcul deterministe), puis assertions sur les appels enregistres et le texte final.
- Le modele doit etre **compatible tool calling** (format tools OpenAI). Une reponse HTTP 400 mentionnant les tools provoque l'arret avec le code de sortie 2 et un message explicite.

## Variables d'environnement

| Variable | Defaut | Role |
|---|---|---|
| `EARTHCOACH_EVAL_MODEL` | *(requis)* | Nom du modele a evaluer (le script s'arrete tot avec un message s'il manque). |
| `EARTHCOACH_EVAL_BASE_URL` | `http://localhost:11434/v1` | Base de l'API OpenAI-compatible (Ollama par defaut). |
| `EARTHCOACH_EVAL_API_KEY` | *(vide)* | Cle optionnelle ; l'en-tete `Authorization` est omis quand elle est absente. |
| `EARTHCOACH_EVAL_SCENARIOS` | *(tous)* | Filtre d'ids separes par des virgules (ex: `badge_present,english_listing`). |
| `EARTHCOACH_EVAL_MAX_TURNS` | `6` | Plafond de tours de conversation par scenario ; depasse = echec `no final text`. |

## Lancer

```bash
# Bash (Ollama local, modele quelconque supportant les tools)
EARTHCOACH_EVAL_MODEL=llama3.1 npm run test:earthcoach:eval
```

```powershell
# PowerShell
$env:EARTHCOACH_EVAL_MODEL='llama3.1'; npm run test:earthcoach:eval
```

Codes de sortie : `0` tout passe, `1` au moins un echec, `2` modele non compatible tool calling.

## Avertissement : non-determinisme

Les assertions sont des **evals comportementales**, pas des tests unitaires : la sortie du modele varie d'un run a l'autre, meme a `temperature: 0.2`. Distinction a lire dans la sortie :

- `failures` = ecart net au contrat attendu (tool non appele, capture mal formee, reponse inventee sans observation, badge absent...) ;
- `warnings` = soupcon a verifier a la main (ordre des questions paraphrase, enumeration ambigue, reponse peut-etre pas en anglais).

Sur les petits modeles, un jeu de FAIL est attendu : rejouez plusieurs fois avant de conclure a une regression, et comparez les modeles plutot que d'exiger un score parfait.
