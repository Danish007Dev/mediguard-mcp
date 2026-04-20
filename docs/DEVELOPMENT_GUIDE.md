# MediGuard MCP - Development Instructions

## 🚀 Quick Start (First Time Setup)

### Prerequisites
```bash
# Verify you have the right versions
node --version  # Should be 18+
npm --version   # Should be 9+
git --version   # Any recent version
```

### Initial Setup
```bash
# 1. Create project directory
mkdir mediguard-mcp
cd mediguard-mcp

# 2. Initialize Git
git init
git remote add origin <your-github-repo-url>

# 3. Copy all .github files from this template
# (The files you're reading now)

# 4. Initialize Node.js project
npm init -y

# 5. Install TypeScript and MCP SDK
npm install --save @modelcontextprotocol/sdk
npm install --save-dev typescript @types/node ts-node

# 6. Install other dependencies
npm install --save \
  @anthropic-ai/sdk \
  zod \
  dotenv

npm install --save-dev \
  @typescript-eslint/eslint-plugin \
  @typescript-eslint/parser \
  eslint \
  prettier \
  jest \
  @types/jest \
  ts-jest

# 7. Initialize TypeScript
npx tsc --init

# 8. Create environment file
cp .env.example .env
# Then edit .env and add your API keys
```

### Project Structure
```
mediguard-mcp/
├── .github/                    # GitHub config (you have this)
│   ├── workflows/
│   │   └── ci-cd.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PROJECT_ROADMAP.md
│   └── scripts/
├── .cursor/                    # Cursor AI rules (you have this)
│   └── rules
├── src/                        # YOUR CODE GOES HERE
│   ├── server.ts              # Main MCP server
│   ├── tools/                 # Tool implementations
│   │   ├── drug-interactions.ts
│   │   ├── polypharmacy.ts
│   │   ├── contraindications.ts
│   │   ├── safer-alternatives.ts
│   │   └── safety-explanation.ts
│   ├── clients/               # API clients
│   │   ├── rxnorm-client.ts
│   │   ├── openfda-client.ts
│   │   ├── fhir-client.ts
│   │   └── claude-client.ts
│   ├── types/                 # TypeScript types
│   │   ├── sharp.ts
│   │   ├── drug.ts
│   │   └── fhir.ts
│   └── utils/                 # Utilities
│       ├── logger.ts
│       ├── cache.ts
│       └── validators.ts
├── tests/                      # Tests
│   ├── unit/
│   ├── integration/
│   └── safety/
├── docs/                       # Documentation
│   ├── API.md
│   ├── INTEGRATION_GUIDE.md
│   └── SHARP_SUPPORT.md
├── .env.example                # Environment template
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── prompt-opinion.config.json  # Marketplace config
```

---

## 📝 Phase-by-Phase Instructions

### PHASE 1: Foundation (Days 1-3)

#### Day 1: Create Basic MCP Server

**File: `src/server.ts`**
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'mediguard-mcp',
  version: '1.0.0',
  capabilities: {
    tools: {}
  }
});

// Add a simple test tool
server.tool(
  'ping',
  'Test tool to verify MCP server is working',
  {},
  async () => {
    return { message: 'MediGuard MCP Server is running!' };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MediGuard MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
```

**Test it:**
```bash
# Compile
npx tsc

# Run
node dist/server.js

# In another terminal, use MCP Inspector
npx @modelcontextprotocol/inspector node dist/server.js
```

#### Day 2: Set Up Testing

**File: `tests/unit/server.test.ts`**
```typescript
import { describe, it, expect } from '@jest/globals';

describe('MediGuard MCP Server', () => {
  it('should initialize successfully', () => {
    expect(true).toBe(true); // Start simple
  });
});
```

**File: `jest.config.js`**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
```

**Run tests:**
```bash
npm test
```

#### Day 3: Register on Prompt Opinion

1. Go to https://promptopinion.ai
2. Create account
3. Navigate to Marketplace
4. Click "Publish New Server"
5. Read documentation
6. Note down requirements for submission

---

### PHASE 2: Core Tools (Days 4-10)

#### Day 4-5: Tool 1 - Drug Interaction Checker

**Step 1: Create RxNorm Client**

**File: `src/clients/rxnorm-client.ts`**
```typescript
interface RxNormResult {
  ok: boolean;
  data?: string; // RxCUI
  error?: Error;
}

export class RxNormClient {
  private cache = new Map<string, string>();
  private baseUrl = 'https://rxnav.nlm.nih.gov/REST';

  async normalizeToRxCUI(drugName: string): Promise<RxNormResult> {
    // Check cache first
    const cached = this.cache.get(drugName.toLowerCase());
    if (cached) {
      return { ok: true, data: cached };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/rxcui.json?name=${encodeURIComponent(drugName)}`
      );

      if (!response.ok) {
        throw new Error(`RxNorm API error: ${response.status}`);
      }

      const data = await response.json();
      const rxcui = data.idGroup?.rxnormId?.[0];

      if (!rxcui) {
        return { 
          ok: false, 
          error: new Error(`Drug not found: ${drugName}`) 
        };
      }

      // Cache it
      this.cache.set(drugName.toLowerCase(), rxcui);

      return { ok: true, data: rxcui };
    } catch (error) {
      return { ok: false, error: error as Error };
    }
  }

  async getInteractions(rxcuis: string[]): Promise<any> {
    // Implement interaction checking
    // Use: /interaction/list.json endpoint
  }
}
```

**Step 2: Implement the Tool**

**File: `src/tools/drug-interactions.ts`**
```typescript
import { z } from 'zod';
import { RxNormClient } from '../clients/rxnorm-client';
import { ClaudeClient } from '../clients/claude-client';

const InputSchema = z.object({
  medications: z.array(z.string()).min(1).max(50),
  patient_context: z.object({
    patient_id: z.string(),
    fhir_endpoint: z.string().url(),
    fhir_token: z.string()
  }).optional()
});

export async function checkDrugInteractions(input: z.infer<typeof InputSchema>) {
  // 1. Validate input
  const validated = InputSchema.parse(input);
  
  // 2. Normalize drug names to RxCUI
  const rxnormClient = new RxNormClient();
  const rxcuis: string[] = [];
  
  for (const drug of validated.medications) {
    const result = await rxnormClient.normalizeToRxCUI(drug);
    if (result.ok && result.data) {
      rxcuis.push(result.data);
    }
  }
  
  // 3. Check interactions
  const interactions = await rxnormClient.getInteractions(rxcuis);
  
  // 4. Synthesize with Claude
  const claudeClient = new ClaudeClient();
  const analysis = await claudeClient.analyzeInteractions(interactions);
  
  return analysis;
}
```

**Step 3: Add to MCP Server**

**Update `src/server.ts`:**
```typescript
import { checkDrugInteractions } from './tools/drug-interactions';

server.tool(
  'check_drug_interactions',
  'Analyzes potential drug-drug interactions',
  {
    medications: {
      type: 'array',
      items: { type: 'string' },
      description: 'List of medication names'
    },
    patient_context: {
      type: 'object',
      optional: true,
      description: 'SHARP context with patient data'
    }
  },
  async (params) => {
    return await checkDrugInteractions(params);
  }
);
```

**Step 4: Write Tests**

**File: `tests/unit/drug-interactions.test.ts`**
```typescript
describe('Drug Interaction Checker', () => {
  it('should flag warfarin + NSAID as high risk', async () => {
    const result = await checkDrugInteractions({
      medications: ['warfarin', 'ibuprofen']
    });
    
    expect(result.risk_level).toBe('high');
    expect(result.interactions).toHaveLength(1);
  });
  
  it('should handle unknown drugs gracefully', async () => {
    const result = await checkDrugInteractions({
      medications: ['notarealdrug12345']
    });
    
    expect(result.error).toBeDefined();
  });
});
```

**Repeat this pattern for Tools 2-5** following the roadmap.

---

### PHASE 3: SHARP & FHIR Integration (Days 11-13)

#### Day 11-12: FHIR Client

**File: `src/clients/fhir-client.ts`**
```typescript
interface FHIRClientConfig {
  endpoint: string;
  token: string;
}

export class FHIRClient {
  constructor(private config: FHIRClientConfig) {}

  async fetchPatientMedications(patientId: string): Promise<any> {
    const response = await fetch(
      `${this.config.endpoint}/MedicationRequest?patient=${patientId}&status=active`,
      {
        headers: {
          'Authorization': `Bearer ${this.config.token}`,
          'Accept': 'application/fhir+json'
        }
      }
    );

    if (!response.ok) {
      throw new Error('FHIR request failed');
    }

    return await response.json();
  }
}
```

#### Day 13: SHARP Context Support

**File: `src/types/sharp.ts`**
```typescript
export interface SharpContext {
  patient_id: string;
  fhir_endpoint: string;
  fhir_token: string;
  encounter_id?: string;
}
```

**Update all tools to accept SHARP context:**
```typescript
async function checkDrugInteractions(input: {
  medications: string[];
  patient_context?: SharpContext;
}) {
  // If patient context provided, fetch additional data
  if (input.patient_context) {
    const fhirClient = new FHIRClient({
      endpoint: input.patient_context.fhir_endpoint,
      token: input.patient_context.fhir_token
    });
    
    const patientMeds = await fhirClient.fetchPatientMedications(
      input.patient_context.patient_id
    );
    
    // Merge with input medications
    // ...
  }
}
```

---

### PHASE 4-7: Follow Similar Pattern

Each phase follows:
1. Read the task in PROJECT_ROADMAP.md
2. Create necessary files
3. Implement functionality
4. Write tests
5. Verify with `npm test`
6. Commit to Git
7. Check off in roadmap

---

## 🎬 Demo Video Script (Day 21)

### Recording Setup
1. Use OBS Studio or Loom
2. 1920x1080 resolution
3. Clear audio
4. Test recording first

### Script Structure (180 seconds)

**[0:00-0:30] Hook & Problem**
```
"Every year, medication errors harm 1.5 million Americans.
Most are preventable - but doctors review drug lists in just seconds.
Meet MediGuard - the AI safety layer that prevents harm before it happens."

[Show statistics on screen]
```

**[0:30-1:00] Solution Overview**
```
"MediGuard is an MCP server - a tool that any healthcare AI agent can use.
It's like having a clinical pharmacist check every prescription, instantly."

[Show Prompt Opinion marketplace]
[Show MediGuard listed]
```

**[1:00-2:30] Live Demos (30 sec each)**

*Demo 1: Dangerous Interaction*
```
[Screen: Agent interface]
"Watch what happens when a prior authorization agent requests warfarin + ibuprofen..."

[Show tool call]
[Show MediGuard response: HIGH RISK]
[Highlight: "13x increased bleeding risk - recommend acetaminophen instead"]
```

*Demo 2: Polypharmacy*
```
"Now an elderly patient on 15 medications..."

[Show analysis]
[Highlight: "3 potentially inappropriate drugs flagged"]
[Show: Safer regimen suggested]
```

*Demo 3: Cross-Agent*
```
"MediGuard works with ANY agent through MCP standard..."

[Show: Discharge Planner → MediGuard → Pharmacy Agent]
[Show: Safe, validated prescription flow]
```

**[2:30-3:00] Impact**
```
"MediGuard uses FHIR, supports SHARP context, and works across your entire AI ecosystem.
One tool. Every agent safer. Lives saved.

View the code and try it yourself - link in description."
```

---

## 🚨 Common Issues & Solutions

### Issue: RxNorm API rate limiting
**Solution**: Implement aggressive caching. Drug names don't change.

### Issue: FHIR server authentication failing
**Solution**: Use test server first (https://hapi.fhir.org). Real auth later.

### Issue: Claude API costs too high
**Solution**: Use prompt caching, batch requests, add fallback logic.

### Issue: Tests taking too long
**Solution**: Use mocks for external APIs, run in parallel.

### Issue: Can't publish to Prompt Opinion
**Solution**: Join their Discord, ask for help. Very responsive.

---

## 📞 Getting Help

### Use Cursor/Claude Effectively
When stuck, use this prompt template:
```
I'm working on [specific task] for my MCP server.

Context:
- File: src/tools/[filename]
- Goal: [what you're trying to do]
- Current code: [paste code]
- Error: [paste error]

Constraints:
- Must be HIPAA compliant (no PHI in logs)
- Response time < 3 seconds
- TypeScript strict mode

Please help me [specific ask].
```

### Resources
- MCP Docs: https://modelcontextprotocol.io
- Prompt Opinion Discord: [link from platform]
- RxNorm API: https://lhncbc.nlm.nih.gov/RxNav/
- FHIR R4: http://hl7.org/fhir/

---

## ✅ Final Submission Checklist

**Code Quality**
- [ ] All tests passing (80%+ coverage)
- [ ] No hardcoded API keys
- [ ] No PHI in logs
- [ ] TypeScript strict mode passing
- [ ] ESLint passing
- [ ] All functions documented

**Functionality**
- [ ] At least 3 tools working
- [ ] SHARP context support
- [ ] FHIR integration working
- [ ] Response time < 3 seconds

**Documentation**
- [ ] README.md complete
- [ ] API.md with all tools
- [ ] Integration guide
- [ ] .env.example provided

**Marketplace**
- [ ] Published to Prompt Opinion
- [ ] Server discoverable
- [ ] Tools invokable
- [ ] Tested end-to-end

**Demo Video**
- [ ] Under 3 minutes
- [ ] Shows problem clearly
- [ ] Demonstrates 3 scenarios
- [ ] Uploaded to YouTube
- [ ] Link in Devpost submission

**Devpost**
- [ ] All fields complete
- [ ] Video link included
- [ ] GitHub repo linked
- [ ] Clear description
- [ ] Submitted before deadline

---

## 🎉 You've Got This!

Remember:
- Progress > Perfection
- 3 great tools > 5 mediocre ones
- Demo video is CRITICAL
- Start early, iterate often

**Track progress daily** using the issue templates.
**Commit often** to Git.
**Test continuously** don't wait until the end.

Good luck! 🚀
