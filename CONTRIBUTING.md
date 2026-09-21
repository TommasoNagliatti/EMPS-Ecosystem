# Contributing

`main` is the stable branch. Create a branch for every change:

```bash
git checkout -b feature/short-name
git add <files>
git commit -m "feat: describe the change"
git push -u origin feature/short-name
```

Open a Pull Request, describe the behavior change and list the checks run. Avoid direct work on `main`.

Use concise commit prefixes: `feat:`, `fix:`, `docs:`, `test:`, and `chore:`. Keep secrets, real database dumps, local `.env` files and generated artifacts out of commits. Run the relevant component checks before requesting review.
