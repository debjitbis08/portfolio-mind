# Portfolio Mind

A self-hosted AI-powered investment assistant for analyzing Indian stock portfolios. Uses Gemini AI to provide actionable insights based on your holdings, technical indicators, and fundamental research.

---

> **⚠️ IMPORTANT DISCLAIMER**
>
> **This software is for educational and informational purposes only. It is NOT a SEBI-registered investment advisor. The AI-generated suggestions do not constitute financial advice, recommendations, or endorsements to buy, sell, or hold any securities.**
>
> **All investment decisions should be made after consulting with a qualified, SEBI-registered financial advisor. The developers and contributors of this project are not responsible for any financial losses incurred from using this software. Past performance is not indicative of future results. Investing in the stock market involves risks, including the loss of principal.**

---

## Features

- 📊 **Portfolio Dashboard** - View holdings with live prices, returns, and technical indicators
- 🤖 **AI Analysis** - Gemini-powered discovery cycles with actionable BUY/SELL/HOLD suggestions
- 📈 **Technical Indicators** - RSI, SMA-50, SMA-200, wait zone detection
- 📰 **Research Integration** - ValuePickr thesis, Google News sentiment, Reddit discussions
- 📥 **Easy Import** - Upload Groww order history and holdings statements
- 🔒 **Self-Hosted** - Your data stays on your machine with SQLite

## Tech Stack

- **Frontend:** Astro + SolidJS + Tailwind CSS (Catppuccin theme)
- **Backend:** Node.js (TypeScript) with Astro SSR
- **Database:** SQLite with Drizzle ORM
- **AI:** Google Gemini API

## Quick Start

### Prerequisites

- Node.js 20+ (uses Volta for version management)
- A [Gemini API key](https://aistudio.google.com/apikey)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/portfolio-mind.git
cd portfolio-mind

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Required: Login password for the web interface
APP_PASSWORD=your_secure_password_here

# Required: Secret for encrypting sensitive data
# Generate with: openssl rand -hex 32
APP_SECRET=your_32_char_hex_secret_here

# Required: Gemini API key
GEMINI_API_KEY=your_gemini_api_key

# Optional: Database path (defaults to ./data/investor.db)
# DATABASE_PATH=./data/investor.db
```

#### Generating Secure Passwords

Choose one of these methods to generate a strong password:

| Method                     | Command / Link                                                  |
| -------------------------- | --------------------------------------------------------------- |
| **Diceware** (recommended) | [diceware.debjitbiswas.com](https://diceware.debjitbiswas.com/) |
| **OpenSSL**                | `openssl rand -base64 24`                                       |
| **pwgen**                  | `pwgen -s 32 1`                                                 |
| **1Password/Bitwarden**    | Use your password manager's generator                           |

### Running

```bash
# Development mode
pnpm dev

# Production build
pnpm build
pnpm preview
```

Open [http://localhost:4328](http://localhost:4328) and log in with your `APP_PASSWORD`.

## Usage

### 1. Import Your Portfolio

1. Download your **Order History** from Groww (XLSX format)
2. Optionally download your **Holdings Statement** for reconciliation
3. Go to Dashboard → Import Transactions
4. Upload the files

### 2. Refresh Technical Data

Click **⚡ Refresh Technical Data** to calculate RSI and SMA indicators for your holdings.

### 3. Run AI Discovery

Click **Run Discovery Cycle** to analyze your portfolio with Gemini AI. The AI will:

- Research each holding using ValuePickr, news, and fundamentals
- Generate actionable suggestions (BUY/SELL/HOLD)
- Provide rationale for each recommendation

### 4. Review Suggestions

Approve ✓ or reject ✗ suggestions from the dashboard.

## Deployment

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch (first time)
fly launch

# Deploy updates
fly deploy
```

Set secrets:

```bash
fly secrets set APP_PASSWORD="your_password"
fly secrets set APP_SECRET="your_secret"
fly secrets set GEMINI_API_KEY="your_key"
```

## Project Structure

```
src/
├── components/     # SolidJS components
├── layouts/        # Astro layouts
├── lib/
│   ├── db/         # Drizzle schema & database client
│   ├── middleware/ # Auth middleware
│   ├── scrapers/   # Web scrapers (Screener, ValuePickr)
│   └── tools/      # AI tool implementations
├── pages/
│   ├── api/        # API routes
│   └── *.astro     # Page components
```

## License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

```
Portfolio Mind - Self-hosted AI investment assistant
Copyright (C) 2026 Debjit Biswas (https://github.com/debjitbis08)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
```

## Contributing

Contributions are welcome! Please read the license terms before contributing.

## Acknowledgments

- [Catppuccin](https://catppuccin.com/) for the beautiful color palette
- [ValuePickr](https://forum.valuepickr.com/) community for investment research
- Google for the Gemini API
