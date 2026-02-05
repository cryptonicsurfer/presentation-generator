# Verksamhetsplan Database (fbg_planning)

Detta är databasen för Business Falkenbergs strategiska verksamhetsplanering. Datan används för att skapa presentationer om planerade och genomförda aktiviteter.

## Database Schema

### strategic_concepts
Strategiska koncept/kategorier för planering.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Konceptnamn (t.ex. "Verksamhetsplanering", "Företagsträffar") |
| description | TEXT | Beskrivning |
| is_time_based | BOOLEAN | Om konceptet är tidsbaserat (tertial) |
| sort_order | INTEGER | Sorteringsordning |

**Fasta koncept:**
- `Verksamhetsplanering` (11111111-1111-1111-1111-111111111111) - Tidsbaserad planering
- `Företagsträffar` (22222222-2222-2222-2222-222222222222) - Temabaserade aktiviteter

### focus_areas
Fokusområden inom varje koncept.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| concept_id | UUID | FK till strategic_concepts |
| name | VARCHAR(100) | Fokusområdets namn |
| color | VARCHAR(7) | Hex-färgkod (t.ex. #93C5FD) |
| start_month | INTEGER | Startmånad (0-11), NULL för icke-tidsbaserade |
| end_month | INTEGER | Slutmånad (0-11) |
| sort_order | INTEGER | Sorteringsordning |

**Fasta fokusområden för Verksamhetsplanering:**
- Service & Kompetens (#93C5FD) - Blå
- Platsutveckling (#86EFAC) - Grön
- Etablering & Innovation (#FCA5A5) - Röd
- Övrigt (#9CA3AF) - Grå

**Fasta fokusområden för Företagsträffar:**
- Lätt att göra rätt (#93C5FD)
- Mod att växa (#FDBA74)
- Framtidssäkring av företag (#86EFAC)
- Falkenberg växer (#D8B4FE)

### activities
Aktiviteter/händelser i planeringen.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| focus_area_id | UUID | FK till focus_areas |
| title | VARCHAR(200) | Aktivitetens titel |
| description | TEXT | Detaljerad beskrivning |
| start_date | DATE | Startdatum (YYYY-MM-DD) |
| end_date | DATE | Slutdatum |
| responsible | VARCHAR(100) | Ansvarig person |
| purpose | VARCHAR(100) | Syfte (Främja, Utveckla, etc.) |
| theme | VARCHAR(100) | Tema |
| target_group | VARCHAR(200) | Målgrupp |
| status | VARCHAR(20) | Status: 'ongoing', 'decided', 'completed' |
| weeks | INTEGER[] | Veckonummer (1-52) |

**Status-värden:**
- `ongoing` = Pågående (under planering)
- `decided` = Beslutad (godkänd men ej genomförd)
- `completed` = Genomförd

## Tillgängliga Tools

### query_year_plan
Hämtar aktiviteter med filter.

**Parametrar:**
- `year` (number): Filtrera på år (t.ex. 2026)
- `conceptId` (string): Filtrera på koncept-UUID
- `focusAreaId` (string): Filtrera på fokusområde-UUID
- `status` (string): Filtrera på status ('ongoing', 'decided', 'completed')
- `quarter` (number): Filtrera på kvartal (1-4)
- `half` (number): Filtrera på halvår (1 eller 2)

**Exempel:**
```json
{ "year": 2026, "half": 1 }
{ "year": 2026, "status": "decided" }
{ "quarter": 2 }
```

### get_year_plan_summary
Hämtar sammanfattande statistik.

**Parametrar:**
- `year` (number): Filtrera på år
- `conceptId` (string): Filtrera på koncept-UUID

**Returnerar:**
- `byStatus`: Antal per status
- `byFocusArea`: Antal per fokusområde med färg
- `byMonth`: Antal per månad

### get_focus_areas
Hämtar alla fokusområden med koncept och färger. Inga parametrar.

## Presentation Guidelines

### Rekommenderade Charts

**1. Gantt-liknande tidslinje**
Horisontella staplar som visar aktiviteters start- och slutdatum.

```html
<div class="relative h-8 bg-gray-100 rounded">
  <!-- Aktivitet som sträcker sig från 20% till 60% av året -->
  <div class="absolute h-full rounded"
       style="left: 20%; width: 40%; background-color: #93C5FD;">
    <span class="text-xs text-white px-2">Aktivitetsnamn</span>
  </div>
</div>
```

**2. Statusfördelning (Pie/Doughnut)**
Visa fördelning mellan pågående, beslutade och genomförda aktiviteter.

```javascript
new Chart(ctx, {
  type: 'doughnut',
  data: {
    labels: ['Pågående', 'Beslutad', 'Genomförd'],
    datasets: [{
      data: [10, 5, 15],
      backgroundColor: ['#f39200', '#1f4e99', '#52ae32']
    }]
  }
});
```

**3. Fokusområdesfördelning (Bar)**
Antal aktiviteter per fokusområde med respektive färg.

```javascript
new Chart(ctx, {
  type: 'bar',
  data: {
    labels: ['Service & Kompetens', 'Platsutveckling', 'Etablering & Innovation', 'Övrigt'],
    datasets: [{
      data: [8, 12, 6, 4],
      backgroundColor: ['#93C5FD', '#86EFAC', '#FCA5A5', '#9CA3AF']
    }]
  },
  options: {
    indexAxis: 'y' // Horisontella staplar
  }
});
```

**4. Månadskalender**
Grid med månader som visar aktivitetsintensitet.

```html
<div class="grid grid-cols-12 gap-2">
  <div class="text-center p-4 rounded" style="background-color: rgba(31, 78, 153, 0.2);">
    <div class="font-bold">Jan</div>
    <div class="text-2xl">5</div>
    <div class="text-xs">aktiviteter</div>
  </div>
  <!-- ... fler månader -->
</div>
```

**5. Tidslinje per kvartal**
Gruppera aktiviteter per kvartal med sammanfattning.

### Färgkodning

Använd fokusområdenas egna färger:
- Service & Kompetens: `#93C5FD` (ljusblå)
- Platsutveckling: `#86EFAC` (ljusgrön)
- Etablering & Innovation: `#FCA5A5` (ljusröd)
- Övrigt: `#9CA3AF` (grå)

För status:
- Pågående: `#f39200` (Falkenberg havtorn/orange)
- Beslutad: `#1f4e99` (Falkenberg kommunblå)
- Genomförd: `#52ae32` (Falkenberg ängsgrön)

### Slide-förslag

1. **Översikt** - Total statistik och nyckeltal
2. **Fokusområden** - Fördelning och highlights per område
3. **Tidslinje** - Gantt-vy över perioden
4. **Status** - Pie chart + lista på beslutade/pågående
5. **Månadsvy** - Kalender med intensitet
6. **Nästa steg** - Kommande aktiviteter

### Few-shot exempel på prompts

**Exempel 1: Halvårsöversikt**
```
Prompt: "Skapa en presentation för verksamhetsplanen första halvåret 2026"
→ Anropa: query_year_plan({ year: 2026, half: 1 })
→ Anropa: get_year_plan_summary({ year: 2026 })
```

**Exempel 2: Fokusområdesrapport**
```
Prompt: "Visa alla aktiviteter inom Platsutveckling för 2026"
→ Anropa: get_focus_areas() för att hitta fokusområde-ID
→ Anropa: query_year_plan({ year: 2026, focusAreaId: "<uuid>" })
```

**Exempel 3: Statusrapport**
```
Prompt: "Vilka aktiviteter är beslutade men inte genomförda?"
→ Anropa: query_year_plan({ status: "decided" })
```

**Exempel 4: Kvartalsplanering**
```
Prompt: "Skapa en Q2-presentation för 2026"
→ Anropa: query_year_plan({ year: 2026, quarter: 2 })
→ Anropa: get_year_plan_summary({ year: 2026 })
```
