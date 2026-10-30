import { companyPlaybook, messageTemplates, sequences } from "@/lib/store/collections";
import type { CompanyPlaybook, MessageTemplate, Sequence } from "@/lib/types";
import { nowIso, uuid } from "@/lib/util";

/**
 * Demo content for the Playbook area: a starter playbook, a few templates (as
 * if uploaded) and one team sequence that uses them. Only runs when the team
 * has no content of its own yet. Clearly labelled as example content.
 */
export async function seedContentDemo(): Promise<{ templates: number; sequences: number; playbook: boolean }> {
  const now = nowIso();
  let templates = 0;
  let seqs = 0;
  let playbook = false;

  if (!(await companyPlaybook.get("global"))) {
    const pb: CompanyPlaybook = {
      id: "global",
      positioning: "Cartage runs shipping operations for mid-market shippers: a dedicated team on one platform, so growing volume does not mean hiring more coordinators. (Example playbook: replace with yours.)",
      toneRules: ["Write like an operator talking to a peer", "One idea per email, under 90 words", "End with one concrete ask"],
      avoid: ["Exclamation marks", "Claims about savings we cannot cite", "\"Just checking in\""],
      signalAngles: [
        { signalKey: "hiring:transportation_coordinator", angle: "Add shipping capacity without adding another coordinator seat", talkingPoints: ["Open roles are the cost of manual coordination", "A dedicated team absorbs volume spikes"] },
        { signalKey: "technology:spreadsheet_ops", angle: "Get load planning out of the spreadsheet before peak season", talkingPoints: ["One source of truth for tenders and tracking", "Exceptions handled before customers notice"] },
      ],
      personas: [
        { id: uuid(), title: "VP", pains: "cost per shipment and team headcount", angle: "Scale volume without scaling headcount" },
        { id: uuid(), title: "Director", pains: "carrier performance and on-time delivery", angle: "Fewer escalations, better carrier coverage" },
      ],
      objections: [
        { id: uuid(), objection: "We already have a TMS", response: "Most of our customers keep their TMS. We run the work around it: tendering, tracking and exceptions, so the TMS stops being a second job." },
        { id: uuid(), objection: "No budget this year", response: "Fair. Most teams fund us from the coordinator role they no longer need to hire; happy to show the math on your numbers." },
      ],
      updatedAt: now,
      updatedBy: "example content",
    };
    await companyPlaybook.put(pb);
    playbook = true;
  }

  if ((await messageTemplates.list()).length === 0) {
    const t = (name: string, channel: MessageTemplate["channel"], subject: string | null, body: string, tags: string[]): MessageTemplate => ({
      id: uuid(),
      name,
      channel,
      subject,
      body,
      tags,
      status: "approved",
      source: "upload",
      fileName: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.txt`,
      createdBy: "example content",
      updatedBy: "example content",
      createdAt: now,
      updatedAt: now,
    });
    const list = [
      t("Signal-led intro", "email", "{{company}} and {{signal}}", "{{first_name}},\n\nSaw {{signal}} at {{company}}. {{angle}}.\n\n{{proof}}\n\nI built a page with your numbers (about {{shipments_per_month}} shipments a month): {{page_url}}\n\nWorth 15 minutes next week?\n\n{{rep_name}}", ["intro", "example"]),
      t("Short question intro", "email", "Quick question, {{first_name}}", "{{first_name}}, how is {{company}} handling {{signal}} today?\n\nWe help teams at your volume run it without adding coordinators. Your numbers are here: {{page_url}}\n\n{{rep_name}}", ["intro", "example"]),
      t("Value follow-up", "email", "Re: {{company}} shipping", "{{first_name}}, one more thought on {{pain}}.\n\n{{proof}}\n\nThe estimate on your page uses public numbers; happy to redo it with yours: {{page_url}}", ["follow-up", "example"]),
      t("LinkedIn connect", "linkedin", null, "{{first_name}}, I work with {{industry}} shippers on {{signal}}. Would value connecting.", ["linkedin", "example"]),
    ];
    for (const x of list) await messageTemplates.put(x);
    templates = list.length;

    if ((await sequences.list()).length === 0) {
      const seq: Sequence = {
        id: uuid(),
        name: "Signal-led 6 steps (team)",
        description: "Example team cadence built from uploaded templates, with a call on day 3.",
        steps: [
          { id: uuid(), day: 0, channel: "email", title: "Signal-led intro", templateId: list[0].id },
          { id: uuid(), day: 1, channel: "linkedin", title: "LinkedIn connect", templateId: list[3].id },
          { id: uuid(), day: 3, channel: "call", title: "First call", templateId: null },
          { id: uuid(), day: 5, channel: "email", title: "Value follow-up", templateId: list[2].id },
          { id: uuid(), day: 8, channel: "inmail", title: "InMail", templateId: null },
          { id: uuid(), day: 12, channel: "email", title: "Break-up email", templateId: null },
        ],
        status: "active",
        isDefault: false,
        appliesTo: { industries: [], sizeBands: [], signalKeys: [] },
        priority: 0,
        createdBy: "example content",
        createdAt: now,
        updatedAt: now,
      };
      await sequences.put(seq);
      seqs = 1;
    }
  }
  return { templates, sequences: seqs, playbook };
}
