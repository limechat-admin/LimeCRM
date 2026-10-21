import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { ALL_STAGES } from "@/domain/stage-config";
import { recomputeDeal } from "@/server/mrr";
import { transitionDeal, transitionOnboarding } from "@/server/transitions";
import { db } from ".";
import { contacts, dealLineItems, deals, onboardings, organizations, stages, users } from "./schema";

/**
 * Idempotent for config (stages, dev admin). Demo data is only inserted into an empty database.
 * All demo companies and people are fictional.
 */
async function main() {
  for (const s of ALL_STAGES) {
    await db
      .insert(stages)
      .values(s)
      .onConflictDoUpdate({
        target: [stages.pipeline, stages.key],
        set: { name: s.name, position: s.position, kind: s.kind, winProbability: s.winProbability, requiredFields: s.requiredFields },
      });
  }
  console.log(`stages: ${ALL_STAGES.length}`);

  const devEmail = process.env.DEV_USER_EMAIL ?? "nikhil@limechat.ai";
  const [admin] = await db
    .insert(users)
    .values({ email: devEmail, name: "Nikhil Gupta", role: "admin" })
    .onConflictDoUpdate({ target: users.email, set: { role: "admin" } })
    .returning();

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(organizations);
  if (n > 0) {
    console.log("organizations exist; skipping demo data");
    return;
  }

  const team = await db
    .insert(users)
    .values([
      { email: "riya.ae@example.com", name: "Riya Kapoor", role: "sales" },
      { email: "arjun.ae@example.com", name: "Arjun Mehta", role: "sales" },
      { email: "sana.sdr@example.com", name: "Sana Iqbal", role: "sales" },
      { email: "dev.om@example.com", name: "Dev Rao", role: "onboarding" },
      { email: "meera.csm@example.com", name: "Meera Nair", role: "cs" },
      { email: "kabir.fin@example.com", name: "Kabir Shah", role: "finance" },
    ])
    .returning();
  const u = Object.fromEntries(team.map((t) => [t.name.split(" ")[0].toLowerCase(), t.id]));
  const stageId = Object.fromEntries(
    (await db.select().from(stages).where(eq(stages.pipeline, "sales"))).map((s) => [s.key, s.id]),
  );

  type LI = Omit<typeof dealLineItems.$inferInsert, "dealId">;
  const platform = (unitPrice: number, billingCycle: LI["billingCycle"] = "monthly"): LI => ({ kind: "platform_fee", unitPrice, billingCycle });
  const seats = (unitPrice: number, quantity: number, includedFree = 0): LI => ({ kind: "agent_seat", unitPrice, quantity, includedFree });
  const impl = (unitPrice: number): LI => ({ kind: "implementation_fee", unitPrice, billingCycle: "one_time" });
  const voice = (unitPrice: number): LI => ({ kind: "voice_minute", unitPrice, quantity: 0, description: "Usage-based" });

  const demo: {
    org: typeof organizations.$inferInsert;
    contact: Omit<typeof contacts.$inferInsert, "orgId">;
    deal: Omit<typeof deals.$inferInsert, "orgId" | "stageId"> & { stage: string };
    items: LI[];
    win?: boolean;
  }[] = [
    {
      org: { name: "Kumkum Naturals", website: "https://kumkumnaturals.example", segment: "mid_market", industry: "eCommerce", hqCity: "Jaipur", aeId: u.riya, omId: u.dev, lcAccountIds: [41001] },
      contact: { name: "Pooja Sethi", email: "pooja@kumkumnaturals.example", designation: "Head of CX", isDecisionMaker: true },
      deal: { title: "Kumkum Naturals - Chat + Marketing", stage: "won", type: "new_business", ownerId: u.riya, sdrId: u.sana, plan: "LimeBusiness", products: ["Chat BOT", "Marketing Platform"], priority: "high", expectedCloseDate: "2026-10-10", billingCycle: "monthly", contractStart: "2026-10-15", contractRenewal: "2027-10-14", contractLink: "https://drive.example/kumkum-msa", source: "Inbound" },
      items: [platform(18000), seats(1200, 6, 2), impl(25000)],
      win: true,
    },
    {
      org: { name: "Bluejay Apparel", website: "https://bluejay.example", segment: "enterprise", industry: "eCommerce", hqCity: "Bengaluru", aeId: u.arjun, omId: u.dev, csmId: u.meera, lcAccountIds: [40877] },
      contact: { name: "Rahul Bhat", email: "rahul@bluejay.example", designation: "VP Digital", isDecisionMaker: true },
      deal: { title: "Bluejay Apparel - Voice + Chat", stage: "won", type: "new_business", ownerId: u.arjun, plan: "Enterprise/ Custom", products: ["Voice BOT", "Chat BOT"], priority: "high", expectedCloseDate: "2026-09-01", billingCycle: "annual", contractStart: "2026-09-05", contractRenewal: "2027-09-04", contractLink: "https://drive.example/bluejay-msa", source: "Partnerships", partnerName: "Clevertap" },
      items: [platform(900000, "annual"), voice(3.2), impl(150000)],
      win: true,
    },
    {
      org: { name: "Monsoon Coffee Co", website: "https://monsooncoffee.example", segment: "mid_market", industry: "Consumer Tech", hqCity: "Mumbai", aeId: u.riya },
      contact: { name: "Ira Desai", email: "ira@monsooncoffee.example", designation: "Founder", isDecisionMaker: true },
      deal: { title: "Monsoon Coffee - AI Agent", stage: "agreement_sent", type: "new_business", ownerId: u.riya, sdrId: u.sana, plan: "LimeBot", products: ["Chat BOT"], priority: "medium", expectedCloseDate: "2026-11-05", source: "Outbound" },
      items: [platform(12000), impl(0)],
    },
    {
      org: { name: "Vayu Insurance", website: "https://vayu.example", segment: "enterprise", industry: "BFSI", hqCity: "Gurugram", aeId: u.arjun },
      contact: { name: "Neha Malhotra", email: "neha@vayu.example", designation: "CDO", isDecisionMaker: true },
      deal: { title: "Vayu Insurance - Lead Qualification Voice", stage: "commercial_discussion", type: "new_business", ownerId: u.arjun, plan: "Enterprise/ Custom", products: ["Voice BOT"], priority: "high", expectedCloseDate: "2026-12-15", source: "Self Generation" },
      items: [platform(75000)],
    },
    {
      org: { name: "Tara Hotels", website: "https://tarahotels.example", segment: "mid_market", industry: "Hospitality", hqCity: "Goa", aeId: u.arjun },
      contact: { name: "Karan Fernandes", email: "karan@tarahotels.example", designation: "GM Revenue" },
      deal: { title: "Tara Hotels - Reservations Bot", stage: "sql", type: "new_business", ownerId: u.arjun, plan: "LimeBot", products: ["Chat BOT"], priority: "medium", expectedCloseDate: "2026-12-01", source: "Events" },
      items: [],
    },
    {
      org: { name: "Pebble Kids", website: "https://pebblekids.example", segment: "growth_dedicated", industry: "eCommerce", hqCity: "Pune", aeId: u.riya },
      contact: { name: "Ankita Joshi", email: "ankita@pebblekids.example", designation: "Marketing Lead" },
      deal: { title: "Pebble Kids - Broadcasts", stage: "qualified_meeting", type: "new_business", ownerId: u.riya, sdrId: u.sana, plan: "LimeMarketer", products: ["Marketing Platform"], source: "Paid Ads" },
      items: [],
    },
  ];

  for (const d of demo) {
    const [org] = await db.insert(organizations).values(d.org).returning();
    const [contact] = await db.insert(contacts).values({ ...d.contact, orgId: org.id, ownerId: d.org.aeId }).returning();
    const { stage, ...dealFields } = d.deal;
    const startStage = d.win ? "invoice_raised" : stage;
    const [deal] = await db
      .insert(deals)
      .values({ ...dealFields, orgId: org.id, primaryContactId: contact.id, stageId: stageId[startStage] })
      .returning();
    if (d.items.length) {
      await db.insert(dealLineItems).values(d.items.map((i, position) => ({ ...i, dealId: deal.id, position })));
    }
    await db.transaction((tx) => recomputeDeal(tx, deal.id));
    if (d.win) {
      const res = await transitionDeal(deal.id, "won", admin.id);
      if (!res.ok) throw new Error(`${deal.title} could not be won: ${JSON.stringify(res)}`);
    }
  }

  // Bluejay already finished onboarding: kick off, implement, hand to CS.
  const [bluejay] = await db.select().from(organizations).where(eq(organizations.name, "Bluejay Apparel"));
  const [onb] = await db.select().from(onboardings).where(eq(onboardings.orgId, bluejay.id));
  await db.update(onboardings).set({ kickoffDate: "2026-09-10", nps: 9, goLiveDate: "2026-10-01" }).where(eq(onboardings.id, onb.id));
  for (const key of ["kickoff_pending", "implementation", "implementation_done", "handed_to_cs"]) {
    const res = await transitionOnboarding(onb.id, key, admin.id);
    if (!res.ok) throw new Error(`Bluejay onboarding → ${key}: ${JSON.stringify(res)}`);
  }

  console.log(`demo: ${demo.length} organizations, ${team.length} users`);
}

/** Fictional leads at different points of the SDR funnel. Only added when there are none yet. */
async function seedLeads() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(sql`${contacts.leadStatus} is not null`);
  if (n > 0) return console.log("leads exist; skipping demo leads");
  const people = Object.fromEntries((await db.select().from(users)).map((u) => [u.name.split(" ")[0].toLowerCase(), u.id]));
  const [admin] = await db.select().from(users).where(eq(users.role, "admin"));
  const leads = [
    { name: "Farah Siddiqui", designation: "Head of Growth", company: "Saffron Skin", source: "Inbound", status: "not_contacted" },
    { name: "Vikram Pillai", designation: "COO", company: "Coastline Ferries", source: "Outbound", status: "attempted_contact" },
    { name: "Ananya Rao", designation: "CX Lead", company: "Toybox Labs", source: "AI SDR", status: "meeting_scheduled", meetingScheduledAt: "2026-10-23" },
    {
      name: "Harish Menon",
      designation: "VP Marketing",
      company: "Northwind Finserv",
      source: "Events",
      status: "meeting_completed",
      meetingScheduledAt: "2026-10-15",
      meetingCompletedAt: "2026-10-16",
      productInterest: ["Voice BOT"],
      bant: [20, 20, 15, 22],
    },
  ];
  for (const l of leads) {
    const [org] = await db.insert(organizations).values({ name: l.company, aeId: people.arjun }).returning();
    await db.insert(contacts).values({
      orgId: org.id,
      name: l.name,
      designation: l.designation,
      email: `${l.name.split(" ")[0].toLowerCase()}@${l.company.toLowerCase().replace(/\s+/g, "")}.example`,
      source: l.source,
      leadStatus: l.status,
      leadStage: "lead",
      sdrId: people.sana,
      ownerId: l.status.startsWith("meeting") ? people.arjun : null,
      meetingScheduledAt: l.meetingScheduledAt ?? null,
      meetingCompletedAt: l.meetingCompletedAt ?? null,
      productInterest: l.productInterest ?? [],
      bantBudget: l.bant?.[0] ?? null,
      bantAuthority: l.bant?.[1] ?? null,
      bantNeed: l.bant?.[2] ?? null,
      bantTimeline: l.bant?.[3] ?? null,
    });
  }
  console.log(`demo leads: ${leads.length} (seeded by ${admin?.name ?? "seed"})`);
}

main()
  .then(seedLeads)
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
