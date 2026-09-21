import { type ExtensionAPI, type ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { createExpandableDetails, expandableMessageRenderer, restoreLatestExpandable } from '../../utils/expandable.ts';

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer('Tools', expandableMessageRenderer);
  pi.registerMessageRenderer('Commands', expandableMessageRenderer);

  pi.on('session_start', (_event, ctx) => {
    restoreLatestExpandable(ctx.sessionManager.getEntries());
  });

  pi.registerCommand('commands', {
    description: 'List available commands',
    handler: (_args: string, _ctx: ExtensionCommandContext) => {
      const extensions = pi
        .getCommands()
        .filter((cmd) => cmd.source === 'extension')
        .map((cmd) => {
          return `- \`\/${cmd.name}\`: ${cmd.description || 'No description'}`;
        });

      const prompts = pi
        .getCommands()
        .filter((cmd) => cmd.source === 'prompt')
        .map((cmd) => {
          return `- \`\/${cmd.name}\`: ${cmd.description || 'No description'}`;
        });

      const skills = pi
        .getCommands()
        .filter((cmd) => cmd.source === 'skill')
        .map((cmd) => {
          return `- \`\/${cmd.name}\`: ${cmd.description || 'No description'}`;
        });

      const expanded = [
        '## Extensions',
        '',
        `${extensions.length > 0 ? extensions.join('\n') : '- None'}`,
        '',
        '## Prompts',
        '',
        `${prompts.length > 0 ? prompts.join('\n') : '- None'}`,
        '',
        '## Skills',
        '',
        `${skills.length > 0 ? skills.join('\n') : '- None'}`,
      ].join('\n');

      return Promise.resolve(
        pi.sendMessage(
          {
            customType: 'Commands',
            content: `Extensions: ${extensions.length} · Prompts: ${prompts.length} · Skills: ${skills.length}`,
            display: true,
            details: createExpandableDetails(expanded),
          },
          { triggerTurn: false },
        ),
      );
    },
  });

  pi.registerCommand('tools', {
    description: 'List available tools',
    handler: (_args: string, _ctx: ExtensionCommandContext) => {
      const activeTools = pi.getActiveTools();
      const tools = pi
        .getAllTools()
        .filter((tool) => activeTools.includes(tool.name))
        .map((tool) => {
          return `- \`\/#tool:${tool.name}\`: ${tool.description || 'No description'}`;
        });

      return Promise.resolve(
        pi.sendMessage(
          {
            customType: 'Tools',
            content: `Tools: ${tools.length}`,
            display: true,
            details: createExpandableDetails(tools.length > 0 ? tools.join('\n') : '- None'),
          },
          { triggerTurn: false },
        ),
      );
    },
  });

  pi.registerCommand('system', {
    description: 'Dump the current system prompt',
    handler: (_args: string, ctx: ExtensionCommandContext) => {
      return Promise.resolve(
        pi.sendMessage(
          {
            customType: 'Catalog',
            content: ['## System Prompt', '', '```', ctx.getSystemPrompt(), '```'].join('\n'),
            display: true,
            details: { command: 'system' },
          },
          { triggerTurn: false },
        ),
      );
    },
  });
}
