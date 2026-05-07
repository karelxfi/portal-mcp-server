import type { Meta, StoryObj } from '@storybook/html'

type WorkspaceArgs = {
  eyebrow: string
  title: string
  summary: string
  chip: string
}

const meta = {
  title: 'Portal/Workspace',
  args: {
    eyebrow: 'Storybook is wired up',
    title: 'Use this workspace to grow UI stories without touching the MCP host runtime.',
    summary:
      'The current Portal app entrypoint bootstraps an MCP host connection on import, so this starter story keeps Storybook isolated until we split more UI into story-friendly modules.',
    chip: 'Ready for addon-mcp',
  },
  render: ({ eyebrow, title, summary, chip }) => `
    <section
      style="
        min-height: 100vh;
        padding: 48px 24px;
        background:
          radial-gradient(circle at top, rgba(76, 141, 255, 0.16), transparent 30%),
          linear-gradient(180deg, #10141d 0%, #05070b 100%);
        color: #f5f7fa;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      "
    >
      <div
        style="
          max-width: 860px;
          margin: 0 auto;
          padding: 32px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 28px;
          background: rgba(14, 18, 26, 0.92);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
        "
      >
        <div
          style="
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            border-radius: 999px;
            background: rgba(76, 141, 255, 0.14);
            color: #8fbcff;
            font-size: 13px;
            font-weight: 600;
            letter-spacing: 0.01em;
          "
        >
          ${eyebrow}
        </div>
        <h1
          style="
            margin: 20px 0 12px;
            font-size: clamp(32px, 5vw, 56px);
            line-height: 1.02;
            letter-spacing: -0.05em;
            max-width: 12ch;
          "
        >
          ${title}
        </h1>
        <p
          style="
            margin: 0;
            max-width: 60ch;
            color: rgba(245, 247, 250, 0.76);
            font-size: 17px;
            line-height: 1.6;
          "
        >
          ${summary}
        </p>
        <div
          style="
            margin-top: 28px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 14px;
          "
        >
          <article
            style="
              padding: 18px;
              border-radius: 20px;
              background: rgba(255, 255, 255, 0.04);
              border: 1px solid rgba(255, 255, 255, 0.06);
            "
          >
            <div style="color: rgba(255, 255, 255, 0.52); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">
              Addon
            </div>
            <div style="margin-top: 8px; font-size: 22px; font-weight: 650;">
              ${chip}
            </div>
          </article>
          <article
            style="
              padding: 18px;
              border-radius: 20px;
              background: rgba(255, 255, 255, 0.04);
              border: 1px solid rgba(255, 255, 255, 0.06);
            "
          >
            <div style="color: rgba(255, 255, 255, 0.52); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">
              Next step
            </div>
            <div style="margin-top: 8px; font-size: 22px; font-weight: 650;">
              Extract storyable view modules
            </div>
          </article>
          <article
            style="
              padding: 18px;
              border-radius: 20px;
              background: rgba(255, 255, 255, 0.04);
              border: 1px solid rgba(255, 255, 255, 0.06);
            "
          >
            <div style="color: rgba(255, 255, 255, 0.52); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;">
              Runtime boundary
            </div>
            <div style="margin-top: 8px; font-size: 22px; font-weight: 650;">
              Keep MCP host boot outside stories
            </div>
          </article>
        </div>
      </div>
    </section>
  `,
} satisfies Meta<WorkspaceArgs>

export default meta

type Story = StoryObj<WorkspaceArgs>

export const Default: Story = {}

export const RefactorTarget: Story = {
  args: {
    eyebrow: 'Current app shape',
    title: 'The full Portal app can move into Storybook once its rendering logic is split from host connection setup.',
    summary:
      'A good next cut is extracting pure view functions or DOM factories from src/ui/portal-app.js, then importing those into stories while the MCP host bootstrap stays in the production entrypoint.',
    chip: 'Needs decomposition',
  },
}
