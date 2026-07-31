# R — Identidade Visual & Sistema de Design

Skill para construir qualquer artefato (slide, site, app, peça gráfica) dentro da identidade da marca **R**. Funciona como fonte da verdade: copie tokens, regras e padrões daqui em vez de reinventar.

---

## 1. Princípios

1. **Símbolo único.** A marca é a letra **R**. Não existe logotipo escrito; o antigo "MÍDIAS" foi removido. Tudo carrega só o símbolo.
2. **Calor controlado.** Família única de laranjas + neutros cremes. O gradiente é acento, nunca preenche fundos.
3. **iOS-first.** Squircles, vidro fosco, raios sistêmicos (22% no ícone), tipografia San Francisco, controles segmentados, pílulas.
4. **Espaços brancos.** Densidade baixa, respiro alto. Se uma seção parece vazia, é problema de composição — não de conteúdo. Mil "não" para cada "sim".

**Antipadrões** (não fazer):
- Stacks com 3+ cores de marca diferentes
- Gradientes em fundo de página inteira
- Bordas com `#000` puro
- Cantos retos em containers
- Fontes fora da família SF
- Emojis decorativos
- Texto abaixo de 13px (web) / 24px (slides 1920×1080)
- Drop-shadow padrão CSS sem tint laranja
- Escrever "Mídias" junto da letra R

---

## 2. Tokens — Cores

```css
:root {
  /* Brand */
  --orange-50:  #FFF4E8;   /* Cream  — fundos sutis, badges */
  --orange-100: #FDE3C7;   /* Peach  — washes, hovers */
  --orange-300: #F8A23B;   /* Amber  — início do gradiente */
  --orange-500: #F08113;   /* Solar  — primária */
  --orange-600: #E94D1D;   /* Ember  — fim do gradiente, links */
  --orange-700: #C13A12;   /* Sombra interna */

  --brand-grad:      linear-gradient(135deg, #F8A23B 0%, #F08113 48%, #E94D1D 100%);
  --brand-grad-soft: linear-gradient(135deg, #FDB976 0%, #F39553 50%, #EE6F3A 100%);

  /* Neutros quentes — onde a UI vive */
  --paper:   #FAF7F2;      /* Background da página */
  --paper-2: #F2EEE7;      /* Superfície secundária */
  --paper-3: #E8E3DA;      /* Bordas decorativas, tracks */
  --hairline:        rgba(26,22,20,0.08);
  --hairline-strong: rgba(26,22,20,0.14);
  --ink:     #1A1614;      /* Texto principal */
  --ink-2:   #423B36;      /* Texto secundário */
  --stone:   #87807A;      /* Texto terciário, labels */
  --mist:    #B8B1AB;      /* Placeholders, micro-tipo */
}
```

### Regras de cor
- Laranja sempre como **acento**. Reserve `--brand-grad` para: ícones de app, CTA primário, badges ativas, manchetes pontuais.
- **Texto sobre laranja**: branco (#FFF) ou cream (#FFF4E8).
- **Gradiente em texto**: só em palavras-chave de h1/h2 via `-webkit-background-clip: text`. Nunca em corpo.
- **Modo escuro** (cards/seções dark): `linear-gradient(160deg, #2A211B, #1A1614)` + radial laranja sutil + texto `#FAF7F2`, eyebrow `--orange-300`.
- **Contraste**: AA mínimo para corpo, AAA para microtipo.

---

## 3. Tokens — Tipografia

```css
:root {
  --font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  --font-text:    "SF Pro Text",    -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif;
  --font-mono:    "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
}
```

### Escala

| Token       | Família | Peso | Tamanho        | Letter-spacing | Line-height | Uso |
|-------------|---------|------|----------------|----------------|-------------|-----|
| Display XL  | Display | 600  | clamp 56–124px | -0.04em        | 0.92        | Hero h1 |
| Display     | Display | 600  | 72–92px        | -0.035em       | 0.98        | Section h2 |
| Title       | Display | 600  | 36–56px        | -0.03em        | 1.02        | Card grande / h3 |
| Headline    | Display | 600  | 22–26px        | -0.02em        | 1.1         | Card h4 |
| Subtitle    | Display | 600  | 18–22px        | -0.02em        | 1.15        | Label de card |
| Body L      | Text    | 400  | 19–22px        | -0.01em        | 1.55–1.6    | Lede |
| Body        | Text    | 400  | 15–17px        | -0.01em        | 1.5–1.6     | Corpo |
| Caption     | Text    | 400  | 13–14px        | normal         | 1.5         | Legendas |
| Eyebrow     | Mono    | 400  | 11–14px        | 0.18em + UPPER | 1           | Acima de h2 |
| Mono / dado | Mono    | 400  | 11–14px        | normal         | 1.5         | Hex, números, IDs |

### Regras
- SF Pro **Display** ≥ 22px; SF Pro **Text** < 22px.
- Mínimos: **24px** em slides 1920×1080, **13px** em web.
- `text-wrap: pretty` em headlines.
- `font-feature-settings: "ss01", "cv11"` no body.
- Letter-spacing negativo em display compensa o tracking da SF em tamanhos grandes.
- Mono **obrigatória** para: hex de cor, números absolutos, endereços, código, eyebrows, IDs.

### Componente eyebrow (assinatura)

```html
<div class="eyebrow">Brand Guidelines · v1.0</div>
```
```css
.eyebrow {
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--orange-600);
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.eyebrow::before {
  content: "";
  width: 18px; height: 1px;
  background: var(--orange-500);
}
```

---

## 4. Tokens — Forma & Elevação

### Raios (sistema iOS)

```
8  · chips, badges micro, inputs pequenos
14 · segmented control, input field
18 · cards internos, browser body
22 · cards padrão. Para o ícone use 22% (não pixel)
32 · cards grandes / hero
40 · hero card escuro
999· botões, pills, toggles
```

### Sombras

```css
/* Glass — sombra padrão de cards translúcidos */
--glass-shadow:
  0 30px 60px -20px rgba(170,90,40,0.18),
  0 12px 24px -16px rgba(26,22,20,0.16);

/* Hero gradiente (símbolo grande, card brand) */
--shadow-brand:
  0 40px 80px -20px rgba(233,77,29,0.45),
  inset 0 2px 0 rgba(255,255,255,0.40),
  inset 0 -40px 80px rgba(193,58,18,0.18);

/* Botão primário */
--shadow-cta:
  0 12px 24px -8px rgba(233,77,29,0.50),
  inset 0 1px 0 rgba(255,255,255,0.30);
```

Toda sombra tem **tint laranja** sutil — nunca cinza puro.

---

## 5. Glassmorphism — receita única

```css
.glass {
  background: rgba(255,255,255,0.55);
  -webkit-backdrop-filter: blur(28px) saturate(140%);
          backdrop-filter: blur(28px) saturate(140%);
  border: 1px solid rgba(255,255,255,0.85);
  box-shadow: var(--glass-shadow);
  border-radius: 28px;
}
.glass-strong {
  background: rgba(255,255,255,0.72);
  -webkit-backdrop-filter: blur(40px) saturate(160%);
          backdrop-filter: blur(40px) saturate(160%);
  border: 1px solid rgba(255,255,255,0.85);
  box-shadow: var(--glass-shadow);
  border-radius: 32px;
}
```

**Para o vidro funcionar**, o fundo precisa ter cor/textura. Sem os blobs ambientes (próxima seção), o glass vira só um card branco — efeito perdido.

### Blobs ambientes (atmosfera obrigatória)

Toda página/slide ganha 2 blobs gigantes desfocados. Nunca remover.

```css
.ambient { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; }
.ambient::before {
  content: "";
  position: absolute;
  width: 900px; height: 900px;
  background: radial-gradient(circle, rgba(240,129,19,0.32), transparent 70%);
  filter: blur(140px);
  border-radius: 50%;
  top: -300px; right: -260px;
}
.ambient::after {
  content: "";
  position: absolute;
  width: 800px; height: 800px;
  background: radial-gradient(circle, rgba(233,77,29,0.22), transparent 70%);
  filter: blur(140px);
  border-radius: 50%;
  top: 60%; left: -300px;
}
```

Em slides isolados, use `position: absolute` dentro de `.slide` em vez de `fixed`.

---

## 6. Espaçamento & Layout

### Escala de spacing (múltiplos de 4)

```
4 · 8 · 12 · 14 · 18 · 22 · 24 · 28 · 32 · 40 · 48 · 56 · 64 · 80 · 96 · 120
```

- **Seções web**: padding vertical 120px desktop, 80px mobile.
- **Container max**: 1280px com padding 56px (24px mobile).
- **Gap entre seções**: 64px na seção-head (eyebrow/h2 + lede).
- **Padding de card**: 32–56px conforme tamanho.
- **Hero**: padding-top 88px, padding-bottom 120px.

### Grid

- Layout principal em **CSS Grid ou Flex com `gap`** — nunca margin entre filhos.
- Hero/seção 2 colunas: `1.35fr 1fr` (texto à esquerda) ou `1fr 1.25fr` (mockup à direita maior).
- Cards de capacidade em grid 12 colunas; spans `4 / 6 / 12`.

### Breakpoints

```css
@media (max-width: 1080px) { /* 2 colunas → 1 */ }
@media (max-width: 720px)  { /* mobile: pad reduzido, nav simplificada */ }
```

---

## 7. Componentes

### 7.1 Botão primário (gradiente)

```css
.btn-primary {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--brand-grad);
  color: white; border: 0;
  padding: 16px 26px;
  border-radius: 999px;
  font-family: var(--font-display);
  font-weight: 600; font-size: 16px; letter-spacing: -0.01em;
  box-shadow: 0 12px 26px -8px rgba(233,77,29,0.5), inset 0 1px 0 rgba(255,255,255,0.3);
  cursor: pointer;
  transition: transform .2s, box-shadow .2s;
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 36px -10px rgba(233,77,29,0.6), inset 0 1px 0 rgba(255,255,255,0.3);
}
```

### 7.2 Botão fantasma (vidro)

```css
.btn-ghost {
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(20px);
  color: var(--ink);
  border: 1px solid rgba(255,255,255,0.85);
  padding: 16px 26px;
  border-radius: 999px;
  font-family: var(--font-display);
  font-weight: 600; font-size: 16px;
}
```

### 7.3 Pill / Chip

```css
.chip {
  padding: 8px 14px; border-radius: 999px;
  background: var(--paper-2);
  font-family: var(--font-mono);
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-2);
}
.chip.live   { background: #E8F5EC; color: #1F7A47; }
.chip.review { background: #FFF4E8; color: #C13A12; }
.chip.active { background: var(--brand-grad); color: white; }
```

### 7.4 Segmented control (iOS)

```css
.segmented {
  background: var(--paper-2);
  padding: 4px; border-radius: 14px;
  display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px;
}
.seg { padding: 10px 14px; text-align: center; font-size: 14px; font-weight: 500; color: var(--stone); border-radius: 10px; }
.seg.active { background: white; color: var(--ink); box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
```

### 7.5 Toggle iOS

```css
.toggle { width: 56px; height: 32px; border-radius: 999px; background: var(--paper-3); position: relative; transition: background .2s; }
.toggle.on { background: var(--brand-grad); }
.toggle .knob {
  position: absolute; top: 2px; left: 2px;
  width: 28px; height: 28px; background: white; border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
  transition: transform .2s;
}
.toggle.on .knob { transform: translateX(24px); }
```

### 7.6 Slider

```css
.slider-track { height: 6px; background: var(--paper-3); border-radius: 999px; position: relative; }
.slider-fill  { position: absolute; left: 0; top: 0; bottom: 0; background: var(--brand-grad); border-radius: 999px; }
.slider-thumb { position: absolute; top: 50%; transform: translate(-50%,-50%); width: 22px; height: 22px; background: white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
```

### 7.7 Input field

```css
.input {
  background: rgba(255,255,255,0.75);
  border: 1px solid rgba(255,255,255,0.85);
  border-radius: 16px;
  padding: 14px 18px;
  font-family: var(--font-text); font-size: 16px; color: var(--ink-2);
}
.input::placeholder { color: var(--stone); }
```

### 7.8 Stat card (números grandes)

Glass-strong, número em display 600 64px com gradiente clip, label display 600 17px, sub stone 14px. Padding 32–36px.

### 7.9 Nav flutuante (web)

Pílula em vidro fosco, `position: sticky; top: 16px`, max-width 1180px, padding 12px/22px. Logo R + links pílula + CTA gradiente.

### 7.10 Toast / notification

Card glass-strong com mark à esquerda (44px squircle), conteúdo à direita, timestamp em mono no topo direito. Padding 16px, gap 14px, raio 22px.

---

## 8. O Símbolo R

### Arquivos

| Arquivo | Uso |
|---|---|
| `assets/logo-r.png` | **Primária** — squircle gradiente |
| `assets/logo-r-mono.png` | Mono tinta sobre claro |
| `assets/logo-r-white.png` | Inversa sobre escuro |
| `assets/arrow-gradient.png` / `arrow-orange.png` / `arrow-carbon.png` | Setas — elemento de movimento |

### Tratamentos de ícone (App)

1. **Default** — gradiente solar, squircle 22%
2. **Cream** — fundo `#FFF4E8`, R em gradiente clip
3. **Midnight** — fundo `#0F0C0A`, R em gradiente clip
4. **Tinted** — fundo gradiente `#4B4541 → #2E2925`, R branco
5. **Mono** — fundo `#FAF7F2`, borda 1.5px ink, R em mono

### Regras de uso

- **Clear space** mínimo: `0.5 ×` a largura do símbolo em todos os lados.
- **Tamanho mínimo**: 24px em tela.
- **Container**: sempre squircle (`border-radius: 22%`), nunca círculo, nunca quadrado reto.
- **Setas**: use como ritmo visual (hero, transições). Nunca como bullet, nunca como ícone funcional.

### Não fazer

- Escrever "Mídias" ou qualquer texto junto do R
- Trocar o R por outro caractere
- Aplicar fora do squircle
- Distorcer/rotacionar (exceto inclinação sutil em mockup de cartão)
- Usar a versão antiga com nome em material novo
- Aplicar `box-shadow` cinza puro — sempre com tint laranja

---

## 9. Animação & Motion

### Tempos
- Micro-interação / hover: **200ms**
- Mudança de estado: **250ms**
- Float ambiente: **5–8s** loop
- Easing: `ease-out` para entrada, `ease-in-out` para loops

### Floats canônicos

```css
@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-14px); }
}
@keyframes floatYsoft {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-8px) rotate(-3deg); }
}
```

Aplicar em: símbolo R no hero (8s), seta (5s reverse), chips flutuantes (6s com delays defasados).

### Hover patterns
- Botão primário: `translateY(-2px)` + sombra cresce
- Card de contato: `translateX(4px)` + bg menos transparente
- Link live: `gap` aumenta de 8 → 18px

---

## 10. Padrões de Layout

### Hero (web)
```
Nav pílula sticky
─ Eyebrow
─ H1 gigante com 1 palavra em gradiente clip
─ Lede 20px max 520px
─ CTA primário + ghost
                                    Hero visual:
                                    · Mark grande (squircle) com float
                                    · Seta com float reverse
                                    · 3 chips em vidro com delays defasados
─ Credit strip em vidro (4 stats com números em gradiente)
```

### Seção padrão
```
Eyebrow
H2 grande (com 1 palavra quebrando linha e/ou em gradiente)
Lede à direita
─── ar (mb 64px) ───
Grid de cards (12 colunas / 2 colunas)
```

### Card escuro de seção
Linear-gradient `#2A211B → #1A1614` + radial laranja sutil top-right. Texto cream, eyebrow `--orange-300`. Usado em CTAs e manifestos.

### Slide deck (1920×1080)
- Frame externo: inset 56px (chrome do slide)
- Topbar: dot laranja + nome do projeto à esquerda; numerador `XX / XX` à direita (mono uppercase 16px)
- Conteúdo central em grid 1/2 ou 1.4/1
- Footer: crumbs de seção (`Capa · Marca · Cor · Tipo …`) à esquerda; `R · 2026` à direita
- 7 seções padrão: Capa · Marca · Cor · Tipo · Ícone · Componentes · Aplicações

---

## 11. Copy & Tom de Voz

- **Direto**, sem firula. Verbos no presente.
- **Frases curtas**. Sem palavras de enchimento ("alavancar", "transformar", "soluções").
- **Inglês só quando padrão da indústria** (deploy, sprint, RAG, multi-tenant).
- Português usa **pretty-wrap** e quebras intencionais — não justifique parágrafos curtos.
- Headlines em duas linhas, com 1 palavra de destaque em gradiente.
- Tom para o estúdio: confiante, técnico, sem se vender demais. Apoia em fatos: "5 anos com IA", "R$ 600M em ads", "ArcelorMittal Pecém". Números em mono.

### Frases-modelo
- "Sistemas que pensam, interfaces que respiram."
- "Construímos software com intenção."
- "Vidro, luz e ar."
- "Quatro pilares, um mesmo jeito de pensar."

---

## 12. Acessibilidade

- Foco visível em todos os interativos (`outline: 2px solid var(--orange-500); outline-offset: 4px`).
- Contraste AA mínimo (verificar `--stone` em texto pequeno — só usar em ≥ 14px).
- `prefers-reduced-motion`: desligar todos os `@keyframes` floatY.
- Hit target mínimo: **44 × 44px** (botões, toggles, chips clicáveis).
- Texto sobre gradiente sempre testado em uma cor sólida — se ilegível em `#F08113` puro, está errado.

---

## 13. Stack técnica recomendada

Para portfólio / sites de marca:
- **HTML estático** + CSS puro (variáveis CSS, grid, backdrop-filter)
- React/Next.js para apps. CSS modules ou Tailwind com tokens deste arquivo importados.
- **Sem framework de UI** — componentes pequenos, sob medida. A precisão visual exige.
- **Sem libraries de animação pesadas** — `@keyframes` + `transition` resolvem 95%.
- Fontes: stack de sistema (SF nativa no iOS/macOS). Em outros sistemas, fallback para Inter.

### Pré-flight checklist

Antes de publicar qualquer artefato:
1. Símbolo R presente? Sem texto "Mídias"?
2. Background em `--paper` com 2 blobs ambientes?
3. Todo card é `.glass` ou `.glass-strong`? (ou `.dark` se intencional)
4. Toda sombra tem tint laranja?
5. Tipografia 100% SF (display ≥ 22px, text < 22px, mono em números/eyebrows)?
6. Botão primário usa `--brand-grad` + sombra com `rgba(233,77,29,…)`?
7. Raios seguem o sistema (8/14/18/22/32/999)?
8. Espaçamento múltiplo de 4? Padding de seção ≥ 80px mobile / 120px desktop?
9. Hero tem 1 palavra em gradiente clip?
10. Há ar suficiente? (Se está cheio, está errado.)

---

## 14. Arquivos do projeto

```
assets/
├── logo-r.png            # símbolo primário gradiente
├── logo-r-mono.png       # mono tinta
├── logo-r-white.png      # inverso branco
├── logo-orange.png       # logo "completa" laranja (sem nome) — uso secundário
├── logo-carbon.png       # logo completa carbono
├── logo-white-full.png   # logo completa branco
├── logo-black.png        # logo completa preto
├── logo-gradient.png     # logo completa gradiente
├── arrow-gradient.png    # seta gradiente (hero)
├── arrow-orange.png      # seta laranja (links)
├── arrow-orange-2.png    # seta laranja v2
└── arrow-carbon.png      # seta carbono (modo escuro)

styles.css                # tokens + glass + frame do deck
deck-stage.js             # web component do slide deck
R - Identidade Visual.html   # apresentação 7 slides
R - Portfolio.html        # site portfólio single-page
skill.md                  # este arquivo
```

---

**Última palavra**: quando a tela tem ar, vidro e calor — está certa. Quando precisa explicar o que é importante, está errada.
