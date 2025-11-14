## Colleagues Triggering Your Presentation Workflow

This guide explains how to move from a local Claude Code setup to a web-based deployment where colleagues can trigger your presentation workflow.

### Architecture Overview

You'll build a web app that uses the TypeScript Agent SDK to programmatically orchestrate Claude, replicating what Claude Code does locally but in a controlled server environment.

### Key Implementation Steps

#### 1. Set Up Your Backend Server

```typescript
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import express from 'express';
import { z } from 'zod';

const app = express();
app.use(express.json());

// API endpoint for presentation generation
app.post('/api/generate-presentation', async (req, res) => {
  const { userQuery } = req.body;
  
  try {
    const result = await runPresentationWorkflow(userQuery);
    res.json({ success: true, presentation: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

#### 2. Load Your Skills Programmatically

Since you have skills in `.md` format, read them at startup:

```typescript
import { readFile } from 'fs/promises';
import path from 'path';

// Load your presentation skills
async function loadSkills() {
  const skillsDir = path.join(__dirname, 'skills');
  
  const presentationSkill1 = await readFile(
    path.join(skillsDir, 'presentation-db-1.md'), 
    'utf-8'
  );
  const presentationSkill2 = await readFile(
    path.join(skillsDir, 'presentation-db-2.md'), 
    'utf-8'
  );
  const presentationSkill3 = await readFile(
    path.join(skillsDir, 'presentation-db-3.md'), 
    'utf-8'
  );
  
  return {
    presentationSkill1,
    presentationSkill2,
    presentationSkill3
  };
}
```

#### 3. Create Custom MCP Tools for Database Access

Rather than having Claude read `.env` files directly (security risk in production), create MCP tools:

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import pg from 'pg'; // or your DB client

// Tool for querying Database 1
const queryDb1Tool = tool(
  'query_database_1',
  'Query the sales database for presentation data',
  {
    query: z.string().describe('SQL query to execute'),
    params: z.array(z.any()).optional().describe('Query parameters')
  },
  async (args) => {
    // Server-side DB credentials (not exposed to Claude)
    const client = new pg.Client({
      host: process.env.DB1_HOST,
      database: process.env.DB1_NAME,
      user: process.env.DB1_USER,
      password: process.env.DB1_PASSWORD
    });
    
    await client.connect();
    const result = await client.query(args.query, args.params);
    await client.end();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result.rows, null, 2)
      }]
    };
  }
);

// Similar tools for DB2 and DB3
const queryDb2Tool = tool(/* ... */);
const queryDb3Tool = tool(/* ... */);
```

#### 4. Create an In-Process MCP Server

```typescript
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

const dbMcpServer = createSdkMcpServer({
  name: 'database-access',
  version: '1.0.0',
  tools: [queryDb1Tool, queryDb2Tool, queryDb3Tool]
});
```

#### 5. Build the Presentation Workflow

```typescript
async function runPresentationWorkflow(userQuery: string) {
  const skills = await loadSkills();
  
  // Combine your skills into system prompt
  const systemPrompt = `
You are a presentation generation assistant with access to three databases.

# Workflow Instructions

${skills.presentationSkill1}

---

${skills.presentationSkill2}

---

${skills.presentationSkill3}

# Task

Follow the workflow described above to:
1. Query the three databases using the provided tools
2. Gather insights from the data
3. Create a comprehensive presentation based on: ${userQuery}

Use the presentation skills to format the output as a .pptx file.
`;

  const results: any[] = [];
  
  // Run the query
  const queryInstance = query({
    prompt: userQuery,
    options: {
      systemPrompt,
      mcpServers: {
        'database-access': dbMcpServer
      },
      // Load your pptx skill for presentation creation
      settingSources: [], // Don't load filesystem settings in production
      // Grant necessary permissions
      permissionMode: 'bypassPermissions', // Or implement custom canUseTool
      // Specify working directory for file operations
      cwd: '/tmp/presentations', // Temporary directory for file generation
      allowedTools: [
        'Read', 'Write', 'Edit', // File operations
        'query_database_1', 'query_database_2', 'query_database_3' // Your tools
      ],
      maxTurns: 50 // Limit turns for safety
    }
  });

  // Collect all messages
  for await (const message of queryInstance) {
    results.push(message);
    
    // Log progress
    if (message.type === 'assistant') {
      console.log('Assistant message:', message.message);
    }
    
    if (message.type === 'result') {
      console.log('Final result:', message);
    }
  }

  // Extract the generated presentation file
  const finalResult = results.find(r => r.type === 'result');
  
  // Return file path or content
  return {
    sessionId: finalResult?.session_id,
    result: finalResult?.result,
    // You'd need to read the generated .pptx file from the cwd
    presentationPath: '/tmp/presentations/output.pptx'
  };
}
```

#### 6. Frontend Example

```typescript
// React component example
async function generatePresentation() {
  const response = await fetch('/api/generate-presentation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userQuery: 'Create a Q4 sales performance presentation'
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    // Download the presentation
    window.location.href = `/api/download/${data.presentation.sessionId}`;
  }
}
```

### Important Considerations

#### Security

- **Never expose database credentials to Claude**: Use server-side MCP tools
- **Sanitize SQL queries**: Validate/parameterize queries in your tool handlers
- **Rate limiting**: Prevent abuse of your API
- **Authentication**: Require colleagues to authenticate

#### File Handling

```typescript
// After presentation generation, serve the file
app.get('/api/download/:sessionId', async (req, res) => {
  const filePath = `/tmp/presentations/${req.params.sessionId}/output.pptx`;
  res.download(filePath);
});
```

#### Alternative: Use Subagents

You could also structure each database query as a subagent:

```typescript
options: {
  agents: {
    'db1-analyst': {
      description: 'Analyzes sales data from Database 1',
      tools: ['query_database_1'],
      prompt: skills.presentationSkill1,
      model: 'sonnet'
    },
    'db2-analyst': {
      description: 'Analyzes marketing data from Database 2',
      tools: ['query_database_2'],
      prompt: skills.presentationSkill2,
      model: 'sonnet'
    }
    // ... etc
  }
}
```

### Summary

The key difference from Claude Code:

- **Local (Claude Code)**: You manually execute; Claude has direct filesystem/shell access
- **Web App (Agent SDK)**: Your server controls everything, exposing only specific capabilities via MCP tools

Your skills remain the same (just loaded as system prompts), but database access and file operations are mediated through your backend for security and control.

Would you like me to elaborate on any specific part of this architecture?