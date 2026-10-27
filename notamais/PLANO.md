# NotaMais: planejamento completo

> **Ideia em 1 frase:** ajudar negócios locais (salões, barbearias, clínicas, academias, oficinas, restaurantes) a conseguir **mais avaliações 5★ no Google** com um lembrete automático, cobrando uma mensalidade baixa.
> "NotaMais" é um nome provisório. Antes de registrar domínio e marca, confira se ele está livre.

---

## 1. Resumo em 1 minuto
- **Problema:** quem tem mais avaliações aparece primeiro no "perto de mim". A maioria dos negócios pequenos tem poucas, porque ninguém lembra de pedir.
- **Solução:** link e QR code que abrem direto a tela de avaliação do Google, um display de balcão, mensagens prontas para mandar aos clientes e um resumo semanal mostrando a nota subindo.
- **Estratégia:** **vender antes de programar.** Nas primeiras semanas a entrega é "semi-manual" (com os robôs que já estão prontos nesta pasta). O software completo só é construído quando houver clientes pagando.
- **Preço:** 30 dias grátis, depois **R$ 39/mês** (preço de fundador, fixo) e depois R$ 59/mês para novos clientes.
- **Meta realista:** 10 clientes em 60 dias (≈ R$ 390/mês) e 30 a 50 clientes em 6 meses (≈ R$ 1.200 a R$ 2.500/mês de renda recorrente).

---

## 2. O que está pronto nesta pasta

| Arquivo | Para que serve |
|---|---|
| `buscar-leads.mjs` | **Robô de prospecção:** busca negócios no Google Maps, dá pontos de oportunidade e gera o painel e a planilha. |
| `painel-template.html` | Modelo do painel (mini-CRM) que o robô preenche. |
| `MENSAGENS.md` | Todas as mensagens: 1º contato, follow-up, objeções, fechamento. |
| `imagens/como-funciona.png` | Imagem para mandar aos donos no WhatsApp. |
| `imagens/display-balcao.png` | Exemplo do display de balcão com QR code. |
| `kit-cliente.mjs` | Gera o **kit do cliente** em segundos: link oficial de avaliação, QR code, display em PNG e em PDF A6 e mensagens prontas. |
| `relatorio.mjs` | Gera o **resumo semanal** de cada cliente ("+12 avaliações esta semana"). |

---

## 3. As regras do Google (leia antes de tudo)
O Google **permite e incentiva** pedir avaliações. O que é **proibido** (e pode fazer as avaliações serem removidas ou o perfil ser punido):
1. **Avaliações falsas** ou compradas.
2. **Oferecer qualquer coisa em troca** (desconto, brinde, sorteio).
3. **"Review gating":** pedir só a clientes satisfeitos, ou desviar os insatisfeitos para não avaliarem.

**Como o NotaMais funciona dentro das regras:** o pedido vai para **todos** os clientes, sempre com o link do Google. O canal "fale com o dono" é **extra** e opcional, nunca substitui o link do Google. Explique isso aos clientes; é um argumento de venda ("trabalho 100% dentro das regras").

---

## 4. A oferta

| | Valor | Observação |
|---|---|---|
| Teste | **30 dias grátis** | Sem cartão e sem compromisso. O cliente recebe o kit completo. |
| Fundador (primeiros 20) | **R$ 39/mês** | Preço fixo para sempre: cria urgência. |
| Padrão | R$ 59/mês | Depois dos 20 primeiros. |
| Anual | 10× a mensalidade | Paga 10 meses e leva 12. |

**O que o cliente recebe:**
- Link e QR code direto para a avaliação.
- Display de balcão (arquivo para imprimir, ou você imprime por cerca de R$ 3 a R$ 8 numa gráfica rápida e entrega pessoalmente, o que impressiona).
- Mensagens prontas para mandar aos clientes.
- Resumo semanal no WhatsApp.
- (Fase 2) envio automático pelo WhatsApp e painel online.

**Justificativa de valor:** "se 1 cliente novo por mês vier pelo Google, já se pagou."

---

## 5. Como encontrar as melhores lojas (robô de prospecção)

### 5.1 Configurar a chave do Google (uma vez, cerca de 15 min, grátis)
1. Acesse https://console.cloud.google.com e crie o projeto **notamais**.
2. Em **Faturamento**, vincule uma conta de faturamento (pede cartão, mas existe uma **cota mensal gratuita**: a busca usada pelo robô tem cerca de **1.000 chamadas grátis por mês**, e cada chamada traz até 20 negócios. Confira em https://developers.google.com/maps/billing-and-pricing/pricing).
3. Em **APIs e serviços → Biblioteca**, ative **Places API (New)**.
4. Em **APIs e serviços → Credenciais**, clique em **Criar credencial → Chave de API**. Depois, em **Restringir chave**, permita **só a Places API (New)**.
5. 🔒 **Trava contra cobrança:** em **APIs e serviços → Places API (New) → Cotas**, limite as *requests per day* a **30**. Com isso você nunca passa da cota grátis (30 × 30 dias ≈ 900 por mês). Em **Faturamento → Orçamentos e alertas**, crie também um alerta de R$ 1.
6. Guarde a chave como uma senha. Ela **não** pode ir para o GitHub nem para mensagens.

### 5.1b Sem cartão no Google? Duas alternativas
**A) OpenStreetMap (grátis, sem cadastro e sem chave)**
```bash
node notamais/buscar-leads.mjs --fonte osm --cidade "Belo Horizonte, MG" --nome "Seu Nome"
```
- Traz nome, telefone, categoria e endereço, mas **não traz nota nem número de avaliações**. A mensagem muda para uma pergunta ("vocês costumam pedir avaliação no Google?").
- No painel, toque em **🔎 Conferir avaliações no Google Maps** antes de enviar. Se a loja já tiver centenas de avaliações com nota alta, pule.
- A cobertura é menor que a do Google (o mapa é feito por voluntários), mas cidades grandes costumam ter centenas de negócios com telefone.

**B) Planilha de um serviço com plano grátis (traz nota e avaliações)**
Serviços como **Outscraper** ou **Apify (Google Maps Scraper)** têm uma cota mensal gratuita para exportar resultados do Google Maps. Confira os limites e os termos de uso no site de cada um.
1. Busque, por exemplo, "barbearia em Belo Horizonte" e exporte em **CSV**.
2. Rode:
```bash
node notamais/buscar-leads.mjs --csv caminho/do/arquivo.csv --cidade "Belo Horizonte, MG" --nome "Seu Nome"
```
O robô reconhece sozinho as colunas desses serviços (nome, telefone, nota, avaliações, categoria, endereço), descarta negócios fechados e números 0800, e pontua normalmente.

**Erro no faturamento do Google?** As causas mais comuns no Brasil:
- cartão sem **compras internacionais** liberadas;
- cartão de **débito** (use crédito; um cartão virtual de banco digital costuma funcionar);
- dados (nome e CPF) diferentes dos do titular do cartão.

Tente de novo depois de liberar compras internacionais no app do banco.

### 5.2 Rodar o robô
No seu computador (precisa do Node.js, https://nodejs.org, versão LTS):
```bash
# dentro da pasta do projeto
GOOGLE_MAPS_API_KEY=SUA_CHAVE node notamais/buscar-leads.mjs --cidade "Campinas, SP" --nome "Seu Nome"
# no Windows (PowerShell):
$env:GOOGLE_MAPS_API_KEY="SUA_CHAVE"; node notamais/buscar-leads.mjs --cidade "Campinas, SP" --nome "Seu Nome"
```
- Por padrão, ele busca 15 categorias com até 60 negócios cada, usando cerca de 45 buscas.
- Para focar em algumas categorias: `--categorias "barbearia,salão de beleza,clínica de estética"`
- Para ver um exemplo **sem chave**: `node notamais/buscar-leads.mjs --demo --nome "Seu Nome"`

**Resultado:** a pasta `leads/` com o **`leads.html`** (abra no navegador do celular ou do PC) e o `leads.csv` (Excel ou Google Sheets).

### 5.3 Como o robô escolhe as "melhores lojas"
Cada negócio ganha pontos por:
- **Celular** no perfil (+30), porque quase sempre tem WhatsApp. Telefone fixo vale +5.
- **Poucas avaliações** (até 20: +30; de 21 a 80: +25). Esses ganham mais com o serviço e o resultado aparece rápido.
- **Nota que pode subir** (de 4,0 a 4,5: +25; abaixo de 4,0: +20).
- **Concorrente da mesma categoria com 3× mais avaliações** (+15). Esse é o gancho da mensagem.
- São descartados: negócios fechados, negócios sem telefone e os que já têm muitas avaliações com nota alta (não precisam de você).

**Comece sempre pelos de 70 pontos ou mais.** O filtro do painel já vem assim.

### 5.4 Rotina diária no painel (30 a 45 min)
1. Abra o `leads.html` e filtre por "Pontuação ≥ 70".
2. Em cada loja, toque em **💬 Enviar no WhatsApp**: abre a conversa já com a mensagem personalizada. Revise, anexe `como-funciona.png` se quiser e envie.
3. O painel marca como "enviada" sozinho. Depois de 3 dias, aparece o botão **🔁 Follow-up**.
4. Quando responderem, mude o status (💬 Respondeu, 🔥 Interessado, 🧪 Teste…) e anote o nome do dono e as objeções.
5. Uma vez por semana, use **Exportar status** para ter um backup do seu funil.

> ⚠️ O painel guarda o status **no navegador** em que você abriu. Use sempre o mesmo navegador e exporte o status toda semana.

**Por que não automatizar o envio?** Disparo em massa para quem não te conhece é o motivo nº 1 de banimento no WhatsApp, e conta como mensagem não solicitada. O robô automatiza **tudo até o clique de enviar**; o envio em si fica manual, que é o jeito seguro.

---

## 6. Funil esperado (estimativas para planejar, não garantias)
| Etapa | De cada 100 mensagens |
|---|---|
| Respondem | 15 a 25 |
| Pedem para ver como funciona | 8 a 12 |
| Aceitam o teste grátis | 4 a 8 |
| Viram pagantes após 30 dias | 2 a 5 |

Com 20 mensagens por dia, 5 dias por semana (cerca de 400 por mês), a expectativa é de **8 a 20 novos pagantes por mês** quando o processo estiver afinado. Os primeiros 100 envios servem para **aprender**: ajuste a mensagem conforme as respostas.

**Aumentam muito a conversão:**
- Ir pessoalmente aos que responderam, levando o display impresso.
- Pedir **indicação** para quem virou cliente ("conhece outro dono que gostaria?").
- Contar com 2 ou 3 casos reais na mensagem ("a Barbearia X foi de 18 para 61 avaliações em 30 dias").

---

## 7. Entrega para quem aceita o teste
1. Gere o kit:
   ```bash
   GOOGLE_MAPS_API_KEY=SUA_CHAVE node notamais/kit-cliente.mjs --busca "Barbearia do Zé Campinas"
   ```
   Isso cria `clientes/barbearia-do-ze/` com `display-balcao.png`, `display-A6.pdf`, `qrcode.png` e `mensagens.txt`.
2. Mande ao dono o display, o link e a mensagem pronta (está no `mensagens.txt`).
3. **Teste o link você mesmo** antes de mandar: ele precisa abrir a tela "avaliar" do negócio certo.
4. Marque 🧪 no painel e anote a data de início.

**Toda segunda-feira:**
```bash
GOOGLE_MAPS_API_KEY=SUA_CHAVE node notamais/relatorio.mjs
```
Copie o resumo de cada cliente e mande no WhatsApp. É isso que faz o cliente **ver valor e continuar pagando**.

**No dia 25 do teste:** mande a mensagem de fechamento (veja `MENSAGENS.md`, seção 6).

---

## 8. Como cobrar (sem programar nada)
- **Opção simples:** um **Link de Pagamento recorrente do Stripe** (*Payment Links* com assinatura mensal de R$ 39). Basta criar no painel do Stripe e mandar o link. Ele cobra o cartão todo mês e manda o recibo sozinho.
- **Alternativa:** Pix mensal manual, com um lembrete no dia do vencimento. Funciona para os primeiros clientes, mas dá trabalho e aumenta a inadimplência.
- **Formalização:** para emitir nota fiscal, converse com um contador sobre abrir MEI ou ME (a atividade e o enquadramento certos dependem do seu caso).

---

## 9. Cronograma (5 a 15 h por semana)

| Semana | O que fazer | Meta |
|---|---|---|
| 1 | Chip e WhatsApp Business, chave do Google, rodar o robô na sua cidade, ler `MENSAGENS.md`. | 50 mensagens enviadas |
| 2 | 10 a 20 mensagens por dia, ajustar o texto conforme as respostas, primeiras entregas de kit. | 3 testes grátis |
| 3 | Continuar, visitar pessoalmente quem respondeu, criar o Payment Link do Stripe. | 6 testes |
| 4 | Resumos semanais, pedir indicações. | 10 testes |
| 5–6 | Primeiros fechamentos (fim dos testes). Anotar por que quem não fechou não fechou. | **3 a 5 pagantes** |
| 7–8 | Escalar para cidades vizinhas (rode o robô de novo). | 10 pagantes |
| 9+ | **Fase 2:** com 10 ou mais pagantes, construímos o software (seção 10). | 30 a 50 pagantes em 6 meses |

**Ponto de decisão (semana 6):** se depois de cerca de 300 mensagens ninguém aceitou o teste, o problema está na oferta ou no nicho. Teste outro nicho (por exemplo, só clínicas de estética) antes de desistir.

---

## 10. Fase 2: o software (quando houver demanda comprovada)
O que reaproveitamos do GymApp (login, assinaturas com Stripe, banco protegido com RLS, testes de segurança) acelera muito.

1. **Página de avaliação própria** (`notamais.app/barbearia-do-ze`): "Como foi seu atendimento?", com o botão grande **Avaliar no Google** para **todos** e, abaixo, "Teve algum problema? Fale com o dono". Assim você mede quantas pessoas abriram e clicaram.
2. **Envio automático pelo WhatsApp** (API oficial do WhatsApp Business, que cobra alguns centavos por mensagem e já entra no preço do plano): o dono cadastra o cliente e o telefone em 5 segundos, e a mensagem sai sozinha 2 horas depois.
3. **Painel do cliente** com o gráfico da nota e das avaliações e as reclamações privadas.
4. **Planos:** Essencial R$ 59 (link + QR + painel) e Pro R$ 89 (com envio automático).
5. **Cobrança automática** (o que já existe no GymApp).

Prazo estimado com a base pronta: 3 a 5 semanas.

---

## 11. Custos

| Item | Custo |
|---|---|
| Chip para o WhatsApp Business | ~R$ 15 |
| Google Places API | R$ 0 (com a trava de cota da seção 5.1) |
| Impressão dos displays (opcional) | R$ 3 a R$ 8 cada |
| Stripe | Sem mensalidade; só a taxa sobre cada cobrança |
| Fase 2: Supabase + Vercel | R$ 0 nos planos gratuitos até ganhar escala |
| Domínio (opcional) | ~R$ 40/ano (.com.br) |

---

## 12. Riscos e como reduzir
| Risco | Como reduzir |
|---|---|
| WhatsApp bloquear o número | Chip separado, envio manual, volume crescente, mensagens personalizadas, respeitar o "não". |
| Cliente achar que é golpe | Apresentação clara, teste grátis **sem** pagamento adiantado, visita pessoal, cases reais. |
| Clientes cancelarem depois de alguns meses | Resumo semanal (o valor fica visível), pedir avaliações é um hábito contínuo, plano anual com desconto. |
| Regras do Google | Nunca filtrar e nunca dar incentivo; link oficial do Google. |
| Concorrência | Preço local, atendimento humano pelo WhatsApp e proximidade (você é da região). |
| LGPD na prospecção | Só dados **públicos e comerciais** (o telefone do perfil da empresa), contato B2B de baixo volume, identificação clara e saída fácil ("é só avisar que não mando mais"). Exclua os dados de quem pedir. |

---

## 13. Números para acompanhar toda semana
1. Mensagens enviadas
2. Taxa de resposta (respostas ÷ enviadas)
3. Testes iniciados
4. Conversão teste → pagante
5. Avaliações ganhas por cliente nos primeiros 30 dias (seu principal argumento de venda)
6. Cancelamentos (churn)
7. Receita mensal recorrente (MRR)
