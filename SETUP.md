# Guida al Setup: Pipeline Ingest Automatizzata Scaleway

Questa guida illustra la configurazione del server Scaleway e dei Secret di GitHub per abilitare la pipeline di ingest automatizzata via SSH.

---

## 1. Installazione Dipendenze sul Server Scaleway

Connettiti al server Scaleway tramite SSH:
```bash
ssh <utente>@<ip_server>
```

### A. Aggiornamento dei pacchetti e installazione di `git` e `ffmpeg`
```bash
sudo apt update && sudo apt install -y git ffmpeg python3 python3-pip curl
```

### B. Installazione di `yt-dlp` (o CLI definita in `DOWNLOADER_CMD`)
Si raccomanda di installare `yt-dlp` come file eseguibile in `/usr/local/bin` in modo da consentire l'auto-aggiornamento via `yt-dlp -U`:

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

Verifica le installazioni:
```bash
yt-dlp --version
ffmpeg -version
git --version
```

### C. Clonazione del repository sul server
Posizionati nella cartella desiderata (es. home utente) e clona il repository:
```bash
cd ~
git clone <URL_REPOSITORY_GITHUB> project-flow
cd project-flow
```

Imposta i permessi di esecuzione per lo script di download:
```bash
chmod +x scripts/download.sh
```

---

## 2. Configurazione della Chiave SSH per GitHub Actions

Per permettere a GitHub Actions di connettersi al server Scaleway:

1. Se non disponi già di una chiave SSH dedicata, generala:
   ```bash
   ssh-keygen -t ed25519 -C "github-actions-scaleway" -f ~/.ssh/scaleway_ingest_key -N ""
   ```

2. Aggiungi la chiave pubblica (`~/.ssh/scaleway_ingest_key.pub`) al file `authorized_keys` del server Scaleway:
   ```bash
   cat ~/.ssh/scaleway_ingest_key.pub >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

3. Copia il contenuto della **chiave privata** (`~/.ssh/scaleway_ingest_key`) da configurare su GitHub.

---

## 3. Configurazione dei GitHub Secrets

Nel repository GitHub:
1. Naviga su **Settings** > **Secrets and variables** > **Actions**.
2. Fai clic su **New repository secret** e aggiungi i seguenti 3 Secret:

| Nome Secret | Descrizione | Esempio |
| :--- | :--- | :--- |
| `SCALEWAY_IP` | Indirizzo IP pubblico del server Scaleway | `51.159.x.x` |
| `SCALEWAY_USER` | Nome utente SSH sul server Scaleway | `ubuntu` oppure `root` |
| `SSH_PRIVATE_KEY` | Contenuto completo della chiave SSH PRIVATA | `-----BEGIN OPENSSH PRIVATE KEY----- ...` |

---

## 4. Utilizzo della Pipeline

1. Aggiungi uno o più URL nel file `links.txt` situato nella root del repository (uno per riga).
2. Esegui il commit e il push delle modifiche:
   ```bash
   git add links.txt
   git commit -m "feat: add source URLs for media ingest"
   git push origin main
   ```
3. Il workflow GitHub Action `.github/workflows/download.yml` si attiverà automaticamente sul push di `links.txt`, si connetterà al server Scaleway via SSH, eseguirà `git pull` e lancerà `bash scripts/download.sh`.
4. I video verranno scaricati in `./downloads/` in formato MP4 unendo audio e video tramite `ffmpeg`, e `links.txt` verrà svuotato mantenendo i commenti iniziali.
