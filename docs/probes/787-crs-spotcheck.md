# HO 787 — the CRS spot-check pack: CT's summary beside CRS's, ungraded

> **Diagnostic-only, ungraded.** Base `main` at `88d6327`. Drawn Oct 19, 2026, 7:56 PM MT (2026-10-20 01:56:06Z) by `scripts/diagnostic/gradshow-numbers-787.ts --crs-pack`, seed **787**. Prod was read with `SELECT` only. Congress.gov was read with `CONGRESS_API_KEY` by name, one request in flight and at least 1s between starts: **90 requests** (90 × 200). **Corey grades; nothing here is graded.**

**The input question.** The summarizer's prompt carries the bill's title, its latest action, the CRS summary when one exists and the bill's text, truncated (`lib/summarize.ts:217-220`). It fetches the CRS summaries and takes the newest by `actionDate` (`:151-161`); SKILL records the input (Summarization prompt, `:1887`, `:1900`). So a CT summary written after a CRS summary was published was written with it in view.

**The rule.** A bill is **independent** when every CRS version it has carries an `updateDate` after the CT summary's `summary_updated_at`: no version was there when the summary was written. It is **shown** when at least one was. `updateDate` is the last change Congress.gov records for a version, not the day it was first posted, so a version posted before the CT summary and revised after it would read independent here. The handoff's rule compares only the newest version's date; on a bill with several versions that reads a bill independent though an older version was in the prompt, so this pack uses the stricter rule. 0 of the 90 bills read change class between the two rules.

**The draw.** Candidates: the 18,137 bills with `(is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL`, ordered by id and shuffled by mulberry32(787). Read in that order until 30 were independent or 90 were read: **read 90, independent 3, shown 31, no CRS summary yet 56.** The pack is the independent bills, then the first shown ones in draw order, to 30: **3 independent, 27 shown.**

**What each section quotes.** The CT summary is `bills.summary` as it stands. For an independent bill the CRS text is its newest version; for a shown bill it is the version the prompt carried (the newest that was there when the CT summary was written), with any later version noted. A CRS text over 8,000 characters is cut there and says so; the full text is on the Congress.gov page linked.

| # | bill | class | CT summary written | CRS version quoted |
|---|---|---|---|---|
| 1 | `119-hr-5541` | independent | May 11, 2026, 2:17 AM MT (2026-05-11 08:17:29Z) | Introduced in House, updated Jun 16, 2026, 10:27 AM MT (2026-06-16 16:27:22Z) |
| 2 | `119-s-3820` | independent | May 11, 2026, 1:05 AM MT (2026-05-11 07:05:39Z) | Introduced in Senate, updated May 11, 2026, 10:51 AM MT (2026-05-11 16:51:52Z) |
| 3 | `119-s-2341` | independent | May 11, 2026, 3:54 AM MT (2026-05-11 09:54:39Z) | Introduced in Senate, updated Jun 1, 2026, 3:11 PM MT (2026-06-01 21:11:52Z) |
| 4 | `119-hr-2011` | shown | May 2, 2026, 2:28 PM MT (2026-05-02 20:28:01Z) | Introduced in House, updated May 1, 2026, 11:45 AM MT (2026-05-01 17:45:43Z) |
| 5 | `119-hconres-101` | shown | Jul 18, 2026, 12:01 PM MT (2026-07-18 18:01:21Z) | Introduced in House, updated Jul 18, 2026, 10:28 AM MT (2026-07-18 16:28:55Z) |
| 6 | `119-hr-29` | shown | May 11, 2026, 3:58 AM MT (2026-05-11 09:58:49Z) | Introduced in House, updated Jan 13, 2025, 9:36 AM MT (2025-01-13 16:36:38Z) |
| 7 | `119-hr-1604` | shown | May 10, 2026, 7:08 PM MT (2026-05-11 01:08:01Z) | Introduced in House, updated Jun 9, 2025, 12:30 PM MT (2025-06-09 18:30:32Z) |
| 8 | `119-s-3486` | shown | Oct 8, 2026, 6:00 PM MT (2026-10-09 00:00:33Z) | Introduced in Senate, updated Oct 8, 2026, 1:22 PM MT (2026-10-08 19:22:18Z) |
| 9 | `119-s-3079` | shown | May 11, 2026, 4:13 AM MT (2026-05-11 10:13:00Z) | Introduced in Senate, updated Nov 3, 2025, 8:49 AM MT (2025-11-03 15:49:55Z) |
| 10 | `119-s-147` | shown | May 11, 2026, 5:23 AM MT (2026-05-11 11:23:06Z) | Introduced in Senate, updated Mar 7, 2025, 12:30 PM MT (2025-03-07 19:30:09Z) |
| 11 | `119-hr-919` | shown | Jul 11, 2026, 6:01 PM MT (2026-07-12 00:01:06Z) | Introduced in House, updated Mar 7, 2025, 7:03 AM MT (2025-03-07 14:03:51Z) |
| 12 | `119-hr-1077` | shown | May 23, 2026, 12:20 PM MT (2026-05-23 18:20:36Z) | Introduced in House, updated Jan 5, 2026, 7:44 AM MT (2026-01-05 14:44:51Z) |
| 13 | `119-hr-276` | shown | May 11, 2026, 4:21 AM MT (2026-05-11 10:21:01Z) | Introduced in House, updated Mar 25, 2025, 10:48 AM MT (2025-03-25 16:48:43Z) |
| 14 | `119-s-390` | shown | May 10, 2026, 7:42 PM MT (2026-05-11 01:42:01Z) | Introduced in Senate, updated Apr 3, 2025, 3:31 PM MT (2025-04-03 21:31:55Z) |
| 15 | `119-s-2812` | shown | Sep 24, 2026, 6:10 AM MT (2026-09-24 12:10:33Z) | Introduced in Senate, updated Jul 23, 2026, 12:24 PM MT (2026-07-23 18:24:50Z) |
| 16 | `119-hr-6021` | shown | Sep 18, 2026, 12:10 AM MT (2026-09-18 06:10:25Z) | Introduced in House, updated Apr 8, 2026, 9:03 AM MT (2026-04-08 15:03:54Z) |
| 17 | `119-hr-4690` | shown | Jul 2, 2026, 7:26 AM MT (2026-07-02 13:26:43Z) | Reported to House, updated Apr 17, 2026, 2:14 PM MT (2026-04-17 20:14:08Z) |
| 18 | `119-hr-5291` | shown | May 2, 2026, 12:47 PM MT (2026-05-02 18:47:50Z) | Reported to House, updated Dec 5, 2025, 11:03 AM MT (2025-12-05 18:03:36Z) |
| 19 | `119-hr-2087` | shown | May 11, 2026, 2:11 AM MT (2026-05-11 08:11:49Z) | Introduced in House, updated Jan 15, 2026, 10:50 AM MT (2026-01-15 17:50:42Z) |
| 20 | `119-s-244` | shown | May 11, 2026, 3:11 AM MT (2026-05-11 09:11:57Z) | Introduced in Senate, updated Mar 4, 2025, 4:45 AM MT (2025-03-04 11:45:58Z) |
| 21 | `119-sres-157` | shown | May 10, 2026, 7:25 PM MT (2026-05-11 01:25:37Z) | Passed Senate, updated Mar 26, 2026, 7:25 PM MT (2026-03-27 01:25:03Z) |
| 22 | `119-hr-8130` | shown | May 2, 2026, 2:45 PM MT (2026-05-02 20:45:33Z) | Introduced in House, updated Apr 27, 2026, 8:31 AM MT (2026-04-27 14:31:15Z) |
| 23 | `119-hr-1299` | shown | May 2, 2026, 2:35 PM MT (2026-05-02 20:35:08Z) | Introduced in House, updated Apr 29, 2025, 2:09 PM MT (2025-04-29 20:09:24Z) |
| 24 | `119-hr-1181` | shown | Aug 20, 2026, 12:10 PM MT (2026-08-20 18:10:48Z) | Introduced in House, updated Sep 26, 2025, 12:41 PM MT (2025-09-26 18:41:46Z) |
| 25 | `119-hr-3679` | shown | May 11, 2026, 1:08 AM MT (2026-05-11 07:08:55Z) | Introduced in House, updated Feb 18, 2026, 11:09 AM MT (2026-02-18 18:09:46Z) |
| 26 | `119-hr-1235` | shown | Sep 3, 2026, 12:00 PM MT (2026-09-03 18:00:26Z) | Introduced in House, updated Apr 9, 2025, 12:46 PM MT (2025-04-09 18:46:18Z) |
| 27 | `119-s-1900` | shown | Sep 24, 2026, 6:10 PM MT (2026-09-25 00:10:26Z) | Reported to Senate, updated Mar 30, 2026, 1:32 PM MT (2026-03-30 19:32:26Z) |
| 28 | `119-sres-427` | shown | May 10, 2026, 7:41 PM MT (2026-05-11 01:41:19Z) | Passed Senate, updated Apr 8, 2026, 12:20 PM MT (2026-04-08 18:20:01Z) |
| 29 | `119-hr-9990` | shown | Aug 26, 2026, 12:10 PM MT (2026-08-26 18:10:09Z) | Introduced in House, updated Aug 26, 2026, 9:43 AM MT (2026-08-26 15:43:13Z) |
| 30 | `119-s-1326` | shown | May 11, 2026, 4:28 AM MT (2026-05-11 10:28:36Z) | Introduced in Senate, updated Sep 26, 2025, 9:36 AM MT (2025-09-26 15:36:17Z) |

## 1. `119-hr-5541`: Every Kid Outdoors Reauthorization Act

- **Class:** independent (every CRS version is dated after the CT summary)
- **Introduced:** 2025-09-23 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/5541
- **CT summary written:** May 11, 2026, 2:17 AM MT (2026-05-11 08:17:29Z)
- **CRS summary quoted:** Introduced in House (action date 2025-09-23, version 00), updated Jun 16, 2026, 10:27 AM MT (2026-06-16 16:27:22Z)

**CT summary:**

> This bill would permanently authorize the Every Kid Outdoors program, which currently provides free access to federal lands and waters for fourth graders. If enacted, the program would be expanded to include fifth graders and 11-year-old homeschooled learners, ensuring more children can access outdoor recreational opportunities. It would also increase funding to support program operations, promotion, transportation for needy groups, and outreach to underserved communities.

**CRS summary:**

> Every Kid Outdoors Reauthorization Act
>
> This bill expands and permanently reauthorizes the Every Kid Outdoors Program, which provides passes for free access to federal lands and waters to certain students and accompanying individuals. The existing program applies to fourth-grade students (of any age) and home school learners who are 10 years old. The bill expands the program to include fifth-grade students (of any age) and home-schooled learners who are 11 years of age.

main effect: yes / partly / no

factual error:

## 2. `119-s-3820`: Soil CARE Act of 2026

- **Class:** independent (every CRS version is dated after the CT summary)
- **Introduced:** 2026-02-10 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/3820
- **CT summary written:** May 11, 2026, 1:05 AM MT (2026-05-11 07:05:39Z)
- **CRS summary quoted:** Introduced in Senate (action date 2026-02-10, version 00), updated May 11, 2026, 10:51 AM MT (2026-05-11 16:51:52Z)

**CT summary:**

> This bill would require the Secretary of Agriculture to create a training program for staff of the Natural Resources Conservation Service and external providers. The program would educate them on current methods and science for improving soil health on agricultural land. This aims to help farmers and ranchers better understand and implement practices that regenerate farmland.

**CRS summary:**

> Soil Conservation And Regeneration Education Act of 2026 or the Soil CARE Act of 2026
>
> This bill directs the Department of Agriculture (USDA) to establish a training program for soil health management in Natural Resources Conservation Service (NRCS) programs.
>
> Under the bill, soil health management means land management methods used to increase and balance soil health, such as microbial biomass and macrofauna, for the purpose of improving biological functions, including forming and stabilizing soil structure, cycling nutrients, controlling pests and disease, and degrading or detoxifying contaminants.
>
> The training program must (1) provide education, resources, and technical support to NRCS personnel and third-party providers on the rapidly evolving methodologies, science, and practices for improving soil health; and (2) assist NRCS personnel and third-party providers in supporting agricultural producers in understanding and implementing soil health management systems that regenerate farmland.
>
> The training program must be available twice every two years in each NRCS region and include both an online curriculum and in-person training workshops.
>
> The training program must be developed and delivered through cooperative agreements with entities with soil health management systems expertise and experience working with and training producers.
>
> The bill includes minimum curriculum requirements for the training program, including specific units on soil health and diversified production systems.
>
> USDA must review and update the training program curriculum and materials every two years.

main effect: yes / partly / no

factual error:

## 3. `119-s-2341`: Ensuring Safe and Toxic-Free Foods Act of 2025

- **Class:** independent (every CRS version is dated after the CT summary)
- **Introduced:** 2025-07-17 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/2341
- **CT summary written:** May 11, 2026, 3:54 AM MT (2026-05-11 09:54:39Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-07-17, version 00), updated Jun 1, 2026, 3:11 PM MT (2026-06-01 21:11:52Z)

**CT summary:**

> This bill would change how new substances added to food are approved by requiring manufacturers to submit more detailed safety information to the FDA, which would then be made public for comment. It would also give the FDA more power to object to a manufacturer's safety determination and to reassess previously approved substances, affecting food manufacturers and consumers who want more transparent and rigorous food safety reviews.

**CRS summary:**

> Ensuring Safe and Toxic-Free Foods Act of 2025
>
> This bill limits the circumstances in which a food additive may be considered generally recognized as safe (GRAS) and requires the Food and Drug Administration (FDA) to review the safety of all such additives.
>
> Under current law, food additives generally require pre-market FDA approval unless they are considered GRAS (generally recognized among qualified experts as safe for their intended use). When a manufacturer determines that an additive is GRAS, it may, but is not required to, notify the FDA of that determination. Under the bill, before an additive may be used in food, it must be (1) approved by the FDA, or (2) the subject of a GRAS notification submitted up to two years after the bill’s enactment to which the FDA has not objected.
>
> GRAS notifications submitted after enactment must include specified supporting information. The FDA must publish and seek public comment on such notifications. The FDA must ultimately publish a written determination stating whether it objects to the GRAS determination along with its reasoning.
>
> The FDA may also reassess GRAS notifications submitted before the bill’s enactment and require a manufacturer to submit the same supporting information required of post-enactment notifications.
>
> The FDA must annually review or reassess at least 50 GRAS notifications until all notifications have been reviewed or reassessed. Separately, the FDA must regularly reassess the safety of approved food additives and those considered GRAS.
>
> Finally, the bill makes toxic and carcinogenic substances ineligible to be considered GRAS.

main effect: yes / partly / no

factual error:

## 4. `119-hr-2011`: Sarah Debbink Langenkamp Active Transportation Safety Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-03-10 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/2011
- **CT summary written:** May 2, 2026, 2:28 PM MT (2026-05-02 20:28:01Z)
- **CRS summary quoted:** Introduced in House (action date 2025-03-10, version 00), updated May 1, 2026, 11:45 AM MT (2026-05-01 17:45:43Z)

**CT summary:**

> This bill would allow states to use federal highway safety funds for more types of projects aimed at improving safety for bicyclists and pedestrians, such as connecting existing infrastructure or addressing high-risk areas. It also increases the federal government's share of the cost for these specific safety projects, potentially up to 100%, meaning states would pay less. This could lead to more infrastructure improvements for vulnerable road users nationwide.

**CRS summary:**

> Sarah Debbink Langenkamp Active Transportation Safety Act
>
> This bill expands the Highway Safety Improvement Program (HSIP) to include additional bicyclist and pedestrian safety measures and increases the federal cost share for certain safety projects.
>
> Specifically, the bill allows HSIP to fund projects (1) for the connection of two or more segments of existing bicyclist or pedestrian infrastructure, or (2) that are based on a state's plan to improve the safety of vulnerable road users (e.g., bicyclists or pedestrians) in areas identified as high-risk. In addition, the bill allows an increased federal cost share of up to 100% for these projects.
>
> The bill also allows an increased federal cost share of up to 100% for transportation projects that meet certain criteria, including (1) the project includes a Federal Highway Administration Proven Safety Countermeasure for bicyclists or pedestrians (e.g., bicycle lanes, walkways, and crosswalk visibility enhancements), or (2) the relevant state strategic highway safety plan includes an emphasis area that is related to vulnerable road users.

main effect: yes / partly / no

factual error:

## 5. `119-hconres-101`: Directing the President, pursuant to section 5(c) of the War Powers Resolution, to remove United States Armed Forces from hostilities with Iran.

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2026-05-14 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-concurrent-resolution/101
- **CT summary written:** Jul 18, 2026, 12:01 PM MT (2026-07-18 18:01:21Z)
- **CRS summary quoted:** Introduced in House (action date 2026-05-14, version 00), updated Jul 18, 2026, 10:28 AM MT (2026-07-18 16:28:55Z)

**CT summary:**

> This bill would require the President to remove U.S. Armed Forces from any ongoing hostilities against Iran unless Congress has formally declared war or authorized military force for that specific purpose. It primarily affects the President's authority regarding military deployment and the U.S. military personnel involved in potential conflicts, though it does allow for defensive actions against imminent threats.

**CRS summary:**

> This concurrent resolution directs the President to remove U.S. Armed Forces from hostilities against Iran or any part of its government or military unless a declaration of war or authorization to use military force for such purpose has been enacted.
>
> The resolution specifies that it shall not be construed to prevent the United States from defending itself, its Armed Forces, its diplomatic facilities, or allied states from imminent attack.

main effect: yes / partly / no

factual error:

## 6. `119-hr-29`: Laken Riley Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-01-03 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/29
- **CT summary written:** May 11, 2026, 3:58 AM MT (2026-05-11 09:58:49Z)
- **CRS summary quoted:** Introduced in House (action date 2025-01-03, version 00), updated Jan 13, 2025, 9:36 AM MT (2025-01-13 16:36:38Z)

**CT summary:**

> This bill would require the Department of Homeland Security to detain non-U.S. nationals who are unlawfully present or lack proper documentation and have been arrested for or committed theft-related offenses. It would also allow state governments to sue the federal government over certain immigration enforcement decisions or failures if the state or its residents experience harm, including financial harm over $100. This primarily affects non-U.S. nationals accused of theft and state governments seeking greater oversight of federal immigration actions.

**CRS summary:**

> Laken Riley Act
>
> This bill requires the Department of Homeland Security (DHS) to detain certain non-U.S. nationals (aliens under federal law) who have been arrested for burglary, theft, larceny, or shoplifting. The bill also authorizes states to sue the federal government for decisions or alleged failures related to immigration enforcement.
>
> Under this bill, DHS must detain an individual who (1) is unlawfully present in the United States or did not possess the necessary documents when applying for admission; and (2) has been charged with, arrested for, convicted of, or admits to having committed acts that constitute the essential elements of burglary, theft, larceny, or shoplifting.
>
> The bill also authorizes state governments to sue for injunctive relief over certain immigration-related decisions or alleged failures by the federal government if the decision or failure caused the state or its residents harm, including financial harm of more than $100. Specifically, the state government may sue the federal government over a
>
> - decision to release a non-U.S. national from custody;
>
> - failure to fulfill requirements relating to inspecting individuals seeking admission into the United States, including requirements related to asylum interviews;
>
> - failure to fulfill a requirement to stop issuing visas to nationals of a country that unreasonably denies or delays acceptance of nationals of that country;
>
> - violation of limitations on immigration parole, such as the requirement that parole be granted only on a case-by-case basis; or
>
> - failure to detain an individual who has been ordered removed from the United States.

main effect: yes / partly / no

factual error:

## 7. `119-hr-1604`: Farm and Food Cybersecurity Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-26 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/1604
- **CT summary written:** May 10, 2026, 7:08 PM MT (2026-05-11 01:08:01Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-26, version 00), updated Jun 9, 2025, 12:30 PM MT (2025-06-09 18:30:32Z)

**CT summary:**

> This bill would require the Department of Agriculture to regularly assess cybersecurity threats and vulnerabilities in the agriculture and food supply chain, from farms to consumers. It also mandates annual simulation exercises to test responses to food-related emergencies or disruptions. This would affect all entities involved in the production, processing, distribution, storage, transportation, consumption, or disposal of agricultural or food products by increasing federal oversight and coordination on cybersecurity readiness.

**CRS summary:**

> Farm and Food Cybersecurity Act of 2025
>
> This bill directs the Department of Agriculture (USDA) to (1) assess cybersecurity threats in the agriculture and food critical infrastructure sector, and (2) conduct annual crisis simulation exercises for food-related emergencies or disruptions. The agriculture and food critical infrastructure sector includes (1) any activity relating to the production, processing, distribution, storage, transportation, consumption, or disposal of agricultural or food products; and (2) any entity involved in any of these activities.
>
> Specifically, USDA must conduct a risk assessment every two years on the cybersecurity threats to, and security vulnerabilities in, this sector. The risk assessment must include any recommendations for federal legislative or administrative actions to address related threats and vulnerabilities.
>
> USDA must also conduct an annual simulation exercise relating to a food-related emergency or disruption in coordination with the Department of Homeland Security (DHS), the Department of Health and Human Services (HHS), and the Office of the Director of National Intelligence (ODNI).
>
> Among other things, the exercise must (1) involve a realistic and plausible scenario that simulates a food-related emergency or disruption that affects multiple sectors and jurisdictions, and (2) incorporate input from experts and stakeholders from various disciplines and sectors (e.g., agriculture, public health, emergency management, transportation, and energy).
>
> USDA, in consultation with DHS, HHS, and ODNI, must submit a report to Congress on each simulation exercise, including recommendations to enhance the cybersecurity and resilience of the agriculture and food critical infrastructure sector.

main effect: yes / partly / no

factual error:

## 8. `119-s-3486`: Expand the Behavioral Health Workforce Now Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-12-16 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/3486
- **CT summary written:** Oct 8, 2026, 6:00 PM MT (2026-10-09 00:00:33Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-12-16, version 00), updated Oct 8, 2026, 1:22 PM MT (2026-10-08 19:22:18Z)

**CT summary:**

> This bill would require the federal government to provide guidance to states on how to improve their mental health and substance use disorder services for people covered by Medicaid and CHIP. The guidance would focus on ways states can better train, recruit, and retain providers, especially in rural and underserved areas, potentially increasing access to care for these populations.

**CRS summary:**

> Expand the Behavioral Health Workforce Now Act
>
> This bill requires the Centers for Medicare & Medicaid Services to issue guidance for states on ways to increase education, training, recruitment, and retention of mental health and substance use disorder providers under Medicaid and the Children's Health Insurance Program (CHIP), particularly in rural and underserved areas.

main effect: yes / partly / no

factual error:

## 9. `119-s-3079`: Armed Forces Pay Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-10-30 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/3079
- **CT summary written:** May 11, 2026, 4:13 AM MT (2026-05-11 10:13:00Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-10-30, version 00), updated Nov 3, 2025, 8:49 AM MT (2025-11-03 15:49:55Z)

**CT summary:**

> This bill would ensure that military personnel and civilian employees of the Department of Defense and intelligence agencies continue to receive pay and allowances during a government shutdown. This means that if the government faces a funding lapse, these individuals would still be paid, avoiding disruption to their finances. The bill would remain in effect until regular appropriations are passed or September 30, 2026, whichever comes first.

**CRS summary:**

> Armed Forces Pay Act of 2025
>
> This bill provides continuing appropriations to pay members of the Armed Forces and civilian employees of the Department of Defense (DOD) and intelligence agencies during any period in which interim or full-year appropriations for FY2026 are not in effect (i.e., a government shutdown).
>
> Specifically, the bill provides continuing appropriations for the pay and allowances of (1) members of the Armed Forces, including reserve components, who perform active service or inactive-duty training during the period; and (2) civilian employees of DOD, the Coast Guard, the Office of the Director of National Intelligence, and the Central Intelligence Agency.
>
> The appropriations provided by the bill are available until the earlier of (1) the enactment into law of specified appropriations legislation, or (2) September 30, 2026.
>
> The bill also specifies that the funds provided by this bill for intelligence or intelligence-related activities are deemed to be specifically authorized by the Congress during FY2026 until the enactment of the Intelligence Authorization Act for Fiscal Year 2026.

main effect: yes / partly / no

factual error:

## 10. `119-s-147`: Cleaner Air Spaces Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-01-17 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/147
- **CT summary written:** May 11, 2026, 5:23 AM MT (2026-05-11 11:23:06Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-01-17, version 00), updated Mar 7, 2025, 12:30 PM MT (2025-03-07 19:30:09Z)

**CT summary:**

> This bill would allow the Environmental Protection Agency to provide grants to state and tribal air pollution control agencies. These grants would fund programs to create "clean air centers" in public buildings and distribute air filtration units to low-income households, particularly those with individuals vulnerable to health issues from wildfire smoke. These programs aim to provide cleaner air and educational materials during wildfire smoke events for affected communities.

**CRS summary:**

> Cleaner Air Spaces Act of 2025
>
> This bill requires the Environmental Protection Agency to provide grants to air pollution control agencies, including at least one tribal agency with jurisdiction over air quality, to implement cleaner air space programs (i.e., programs to provide clean air to the public during wildland fire smoke events). Generally, such programs must be located in areas at risk of exposure to wildland fire smoke and must help provide educational materials, clean air centers (i.e., one or more clean air rooms in a publicly accessible building), and air filtration units to certain households. Clean air rooms are rooms designed to keep levels of harmful air pollutants as low as possible during wildland fire smoke events.
>
> Under the bill, air pollution control agencies must partner with at least one community-based organization in implementing such programs.

main effect: yes / partly / no

factual error:

## 11. `119-hr-919`: Chronic Disease Flexible Coverage Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-04 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/919
- **CT summary written:** Jul 11, 2026, 6:01 PM MT (2026-07-12 00:01:06Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-04, version 00), updated Mar 7, 2025, 7:03 AM MT (2025-03-07 14:03:51Z)

**CT summary:**

> This bill would allow people with high-deductible health plans to get certain chronic disease treatments, like insulin for diabetes or statins for heart disease, without first meeting their deductible. This change would make it easier for individuals with chronic conditions to access necessary medications and services earlier in their plan year.

**CRS summary:**

> Chronic Disease Flexible Coverage Act
>
> This bill provides statutory authority for guidance from the Internal Revenue Service (IRS) that expands the types of preventive care that may be offered under a high deductible health plan (HDHP) without requiring a deductible or with a deductible below the minimum threshold.
>
> Under current law, to be considered health savings account-eligible, an HDHP must have a deductible above a certain minimum threshold amount, which is adjusted annually. However, an HDHP may cover certain types of preventive care without requiring a deductible or with a deductible below the minimum threshold.
>
> The IRS issued guidance expanding the types of preventive care that may be covered by an HDHP without requiring a deductible or with a deductible below the minimum threshold to include
>
> - angiotensin converting enzyme inhibitors for individuals with congestive heart failure, diabetes, or coronary artery disease;
>
> - anti-resorptive therapy for individuals with osteoporosis or osteopenia;
>
> - beta-blockers for individuals with congestive heart failure or coronary artery disease;
>
> - blood pressure monitors for individuals with hypertension;
>
> - inhaled corticosteroids and peak flow meters for individuals with asthma;
>
> - insulin and other glucose lowering agents, retinopathy screening, glucometers, and hemoglobin A1c testing for individuals with diabetes;
>
> - international normalized ratio testing for individuals with liver disease or bleeding disorders;
>
> - low-density lipoprotein testing for individuals with heart disease;
>
> - statins for individuals with heart disease or diabetes; and
>
> - selective serotonin reuptake inhibitors for individuals with depression.
>
> The bill provides statutory authority for the IRS's guidance.

main effect: yes / partly / no

factual error:

## 12. `119-hr-1077`: STEAM Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-06 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/1077
- **CT summary written:** May 23, 2026, 12:20 PM MT (2026-05-23 18:20:36Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-06, version 00), updated Jan 5, 2026, 7:44 AM MT (2026-01-05 14:44:51Z)

**CT summary:**

> This bill would speed up the process for approving certain geothermal energy projects by reducing environmental review requirements. Geothermal developers would no longer need extensive environmental assessments for drilling in areas that have seen recent drilling activity or were previously deemed suitable for drilling in an approved land use plan. This change aims to make it faster and potentially cheaper for companies to develop geothermal resources.

**CRS summary:**

> Streamlining Thermal Energy through Advanced Mechanisms Act or the STEAM Act
>
> This bill expedites the environmental review of certain geothermal energy activities under the National Environmental Policy Act of 1969 (NEPA). Specifically, the bill expands the Energy Policy Act of 2005 to include certain geothermal exploration or development activities in an existing categorical exclusion from NEPA for certain oil or gas activities.
>
> A categorical exclusion applies to a class of actions that do not require an environmental assessment nor an environmental impact statement under NEPA.
>
> The categorical exclusion established by the bill applies to drilling a geothermal well (1) in an area where drilling has occurred previously within the five years prior to the date when drilling begins; or (2) within a developed field for which an approved land use plan or environmental document prepared under NEPA determined drilling to be a reasonably foreseeable activity, so long as the plan or document was approved within the five years prior to the date when drilling begins.

main effect: yes / partly / no

factual error:

## 13. `119-hr-276`: Gulf of America Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-01-09 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/276
- **CT summary written:** May 11, 2026, 4:21 AM MT (2026-05-11 10:21:01Z)
- **CRS summary quoted:** Introduced in House (action date 2025-01-09, version 00), updated Mar 25, 2025, 10:48 AM MT (2025-03-25 16:48:43Z)

**CT summary:**

> This bill would change the name of the Gulf of Mexico to the "Gulf of America." All federal agencies would be required to update their official documents and maps to reflect this new name. This would primarily affect federal agencies and anyone who uses their materials, requiring them to adopt the new geographical name.

**CRS summary:**

> Gulf of America Act of 2025
>
> This bill renames the Gulf of Mexico as the Gulf of America and directs federal agencies to update their documents and maps to incorporate the new name.

main effect: yes / partly / no

factual error:

## 14. `119-s-390`: BADGES for Native Communities Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-04 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/390
- **CT summary written:** May 10, 2026, 7:42 PM MT (2026-05-11 01:42:01Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-02-04, version 00), updated Apr 3, 2025, 3:31 PM MT (2025-04-03 21:31:55Z)

**CT summary:**

> This bill would establish a grant program for Native communities to improve responses to missing person cases and death investigations. It would also improve information sharing and training resources for tribal and Bureau of Indian Affairs law enforcement officers. These changes would affect Native American tribes and individuals, as well as federal and tribal law enforcement agencies, by enhancing their ability to investigate and respond to these cases.

**CRS summary:**

> Bridging Agency Data Gaps and Ensuring Safety for Native Communities Act or the BADGES for Native Communities Act
>
> This bill revises federal policies and procedures related to information sharing, reporting, and investigating cases of missing, unidentified, or murdered Indians.
>
> Among other elements, the bill requires the Department of Justice to (1) establish a grant program for specified entities (e.g., tribes) to implement changes to enhance their responses to missing person cases and death investigations of interest to tribes, and (2) work with the Department of Health and Human Services to ensure that federal training resources and culturally appropriate mental health and wellness programs are available to tribal and Bureau of Indian Affairs (BIA) law enforcement officers.
>
> The Department of the Interior must establish a five-year demonstration program for the purpose of conducting or adjudicating personnel background investigations for applicants for law enforcement positions in the BIA.
>
> The bill also requires the Government Accountability Office to conduct specified studies, including a study on the evidence collection, handling, response times, and processing procedures and practices of federal law enforcement agencies.

main effect: yes / partly / no

factual error:

## 15. `119-s-2812`: Brake for Kids Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-09-16 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/2812
- **CT summary written:** Sep 24, 2026, 6:10 AM MT (2026-09-24 12:10:33Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-09-16, version 00), updated Jul 23, 2026, 12:24 PM MT (2026-07-23 18:24:50Z)

**CT summary:**

> This bill directs the Department of Transportation to create a national public safety campaign using various media like TV, radio, and social media. This campaign aims to educate the public on the dangers and illegality of passing stopped school buses, potentially influencing drivers' behavior around school buses.

**CRS summary:**

> Brake for Kids Act of 2025
>
> This bill directs the Department of Transportation to carry out a national public safety campaign on the dangers of illegally passing stopped school buses. Specifically, the campaign must increase awareness and education about the issue through a variety of media, including television, radio, and social media advertising.

main effect: yes / partly / no

factual error:

## 16. `119-hr-6021`: Archie Cavanaugh Migratory Bird Treaty Clarification Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-11-12 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/6021
- **CT summary written:** Sep 18, 2026, 12:10 AM MT (2026-09-18 06:10:25Z)
- **CRS summary quoted:** Introduced in House (action date 2025-11-12, version 00), updated Apr 8, 2026, 9:03 AM MT (2026-04-08 15:03:54Z)

**CT summary:**

> This bill would allow Alaska Natives to possess, sell, or transport authentic handicrafts, clothing, or art containing nonedible migratory bird parts, provided the bird was not taken illegally or wastefully. It directs the Department of State to work with treaty countries to clarify this issue and requires the Department of the Interior to modify regulations for these Alaska Native articles. This would primarily affect Alaska Native artists and cultural practitioners who use migratory bird parts in their traditional crafts.

**CRS summary:**

> Archie Cavanaugh Migratory Bird Treaty Amendment Act
>
> This bill states that nothing in the Migratory Bird Treaty Act of 1918 (MBTA) prohibits possessing, selling, bartering, purchasing, shipping, or transporting any authentic Alaska Native handicraft, clothing, or art on the basis that it contains a nonedible migratory bird part, so long as the bird was not taken in a wasteful or illegal manner. (The MBTA implements four international treaties that the United States entered into with Canada, Mexico, Japan, and Russia. The MBTA prohibits the taking of protected migratory bird species without prior authorization.)
>
> The bill directs the Department of State to work with the Department of the Interior to enter into appropriate bilateral procedures with countries that are parties to the treaties under the MBTA to clarify the treatment of Alaska Native handicraft containing nonedible migratory bird parts from the species of migratory birds listed in those treaties. Further, Interior must modify any regulations implementing the MBTA to implement this bill.

main effect: yes / partly / no

factual error:

## 17. `119-hr-4690`: Reliable Federal Infrastructure Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-07-23 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/4690
- **CT summary written:** Jul 2, 2026, 7:26 AM MT (2026-07-02 13:26:43Z)
- **CRS summary quoted:** Reported to House (action date 2026-02-04, version 07), updated Apr 17, 2026, 2:14 PM MT (2026-04-17 20:14:08Z)

**CT summary:**

> This bill would remove current federal requirements for new and renovated federal buildings to phase out fossil fuel use by 2030, allowing them to continue using fossil fuels. It would also prevent green building certification systems from denying certification to federal buildings solely because they use fossil fuels, impacting federal agencies and contractors involved in building construction and renovation.

**CRS summary:**

> Reliable Federal Infrastructure Act
>
> This bill repeals certain energy efficiency performance standards for new federal buildings and federal buildings undergoing major renovations. Specifically, the bill repeals the performance standards that phase out fossil fuel use in such buildings by FY2030.
>
> The bill directs the Department of Energy to implement the standards as though such phase-out requirements had never taken effect until it issues regulations with revised performance standards.
>
> The bill also specifies that certain systems that certify green buildings may not prohibit federal buildings from obtaining a certification as a green building or high-performance green building solely based on direct or indirect consumption of fossil fuels.

main effect: yes / partly / no

factual error:

## 18. `119-hr-5291`: Merchant Banking Modernization Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-09-10 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/5291
- **CT summary written:** May 2, 2026, 12:47 PM MT (2026-05-02 18:47:50Z)
- **CRS summary quoted:** Reported to House (action date 2025-11-04, version 07), updated Dec 5, 2025, 11:03 AM MT (2025-12-05 18:03:36Z)

**CT summary:**

> This bill would allow financial companies that invest in non-financial businesses to hold those investments for a minimum of 15 years, instead of the current 10-year limit with a possible extension. This change would give financial holding companies more time to manage their equity in private commercial entities they invest in through merchant banking activities.

**CRS summary:**

> Merchant Banking Modernization Act
>
> This bill requires financial holding companies to be allowed to hold merchant banking investments for a minimum of 15 years.
>
> Currently, financial holding companies are generally prohibited from holding interests in nonfinancial companies, however, there are statutory exemptions for merchant banking activities—financial services for private commercial entities. As a result of these financial services, the financial holding company may gain equity in these private commercial entities through portfolio holdings. Under current regulations, these holdings are subject to certain limitations, including a holding limit of 10 years, with the option of extending the period subject to review by the Federal Reserve Board.

main effect: yes / partly / no

factual error:

## 19. `119-hr-2087`: SAFE Bet Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-03-11 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/2087
- **CT summary written:** May 11, 2026, 2:11 AM MT (2026-05-11 08:11:49Z)
- **CRS summary quoted:** Introduced in House (action date 2025-03-11, version 00), updated Jan 15, 2026, 10:50 AM MT (2026-01-15 17:50:42Z)

**CT summary:**

> This bill aims to establish federal standards for sports betting and evaluate its public health effects. If enacted, states would need federal approval for their sports betting programs every three years, adhering to rules like age restrictions, marketing limits, and responsible gambling measures. Individuals who participate in sports betting would be impacted by new protections like deposit limits, income verification, and a national self-exclusion list.

**CRS summary:**

> Supporting Affordability and Fairness with Every Bet Act of 2025 or the SAFE Bet Act of 2025
>
> This bill establishes minimum federal standards for sports betting. It also requires federal agencies to evaluate the effects of sports betting on public health.
>
> The bill prohibits sports betting unless conducted through an approved state program; violations are subject to civil penalties. States administering a sports betting program must obtain approval of the program every three years from the Department of Justice (DOJ).
>
> In providing approval or renewal, DOJ must determine that the state’s program meets minimum standards specified in the bill, including
>
> - designating a state regulatory entity to regulate sports betting operators and enforce state laws,
>
> - prohibiting operators from marketing during live broadcasts of sporting events,
>
> - prohibiting betting by individuals under 21 or members of sports organizations,
>
> - implementing affordability protections such as certain deposit limits and income verification,
>
> - requiring operators to allocate funding for treatment and education on gambling disorders, and
>
> - facilitating a state self-exclusion list (and a national list in coordination with the Substance Abuse and Mental Health Services Administration) so individuals may voluntarily restrict or place limits on their sports betting.
>
> Also, the bill requires various federal agencies to expand surveillance of gambling addiction, conduct a nationwide survey annually on the harm caused by online sports betting, and report to Congress on public health challenges related to sports betting.

main effect: yes / partly / no

factual error:

## 20. `119-s-244`: ROUTERS Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-01-24 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/244
- **CT summary written:** May 11, 2026, 3:11 AM MT (2026-05-11 09:11:57Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-01-24, version 00), updated Mar 4, 2025, 4:45 AM MT (2025-03-04 11:45:58Z)

**CT summary:**

> This bill would require the Department of Commerce to study the national security risks of consumer routers and modems, especially those from companies influenced by China, Iran, North Korea, or Russia. This would primarily affect the Department of Commerce by assigning them this study, and potentially consumers if the study leads to future actions regarding device security.

**CRS summary:**

> Removing Our Unsecure Technologies to Ensure Reliability and Security Act or the ROUTERS Act
>
> This bill requires the Department of Commerce, in consultation with the National Telecommunications and Information Administration, to conduct a study on the national security risks posed by consumer routers and modems (including devices that combine a modem and router) and provide the results of the study to Congress. The study must address devices developed, manufactured, or supplied by persons (i.e., individuals and entities) owned by, controlled by, or subject to the influence of China, Iran, North Korea, or Russia.

main effect: yes / partly / no

factual error:

## 21. `119-sres-157`: A resolution designating April 2025 as "National Native Plant Month".

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-04-05 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-resolution/157
- **CT summary written:** May 10, 2026, 7:25 PM MT (2026-05-11 01:25:37Z)
- **CRS summary quoted:** Passed Senate (action date 2025-04-05, version 55), updated Mar 26, 2026, 7:25 PM MT (2026-03-27 01:25:03Z)

**CT summary:**

> This bill would not change any laws or directly affect individuals. Instead, it designates April 2025 as "National Native Plant Month" to recognize the environmental and economic benefits of native plants. This is a symbolic gesture to raise awareness rather than a regulatory change.

**CRS summary:**

> This resolution designates April 2025 as National Native Plant Month.

main effect: yes / partly / no

factual error:

## 22. `119-hr-8130`: Filer Voter Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2026-03-26 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/8130
- **CT summary written:** May 2, 2026, 2:45 PM MT (2026-05-02 20:45:33Z)
- **CRS summary quoted:** Introduced in House (action date 2026-03-26, version 00), updated Apr 27, 2026, 8:31 AM MT (2026-04-27 14:31:15Z)

**CT summary:**

> This bill would require tax preparers who prepare at least 100 individual tax returns annually to provide voter registration forms to their customers. This change would affect tax preparers by adding voter registration duties and could make it easier for people using these services to register to vote. The Treasury Department would also provide guidance to volunteer tax preparers to help them meet these new requirements.

**CRS summary:**

> Tax Filer Voter Registration Act or the Filer Voter Act
>
> This bill treats certain tax return preparers as voter registration agencies.
>
> Specifically, the bill requires tax return preparers who prepare at least 100 individual tax returns in a taxable year to provide voter registration application forms to their customers. The form must be made available by (1) displaying copies of the form in the preparer's office for customers who receive in-person services, and (2) providing a hyperlink to the form for customers who receive online services.
>
> The bill also outlines the responsibilities of the Department of the Treasury to enable certified volunteer tax preparers to meet the requirements of the bill.

main effect: yes / partly / no

factual error:

## 23. `119-hr-1299`: EAGLES Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-13 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/1299
- **CT summary written:** May 2, 2026, 2:35 PM MT (2026-05-02 20:35:08Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-13, version 00), updated Apr 29, 2025, 2:09 PM MT (2025-04-29 20:09:24Z)

**CT summary:**

> This bill would extend the funding and functions of the Secret Service's National Threat Assessment Center through 2030, which conducts research and provides training on preventing targeted violence. It would expand the Center's activities to include a national program focused on preventing targeted violence in schools. This primarily affects law enforcement, mental health professionals, school personnel, and communities by providing more resources and training to identify and address potential threats of violence.

**CRS summary:**

> EAGLES Act of 2025
>
> This bill reauthorizes the National Threat Assessment Center (NTAC) within the U.S. Secret Service.
>
> It reauthorizes the functions of NTAC through FY2030 and expands them to include additional activities related to the prevention of targeted violence, such as the establishment of a national program on targeted school violence prevention.

main effect: yes / partly / no

factual error:

## 24. `119-hr-1181`: Protecting Privacy in Purchases Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-11 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/1181
- **CT summary written:** Aug 20, 2026, 12:10 PM MT (2026-08-20 18:10:48Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-11, version 00), updated Sep 26, 2025, 12:41 PM MT (2025-09-26 18:41:46Z)

**CT summary:**

> This bill would prevent payment processing companies from assigning special merchant codes that specifically identify firearms retailers, treating them instead like general merchandise or sporting goods stores. This means that purchases at firearms retailers would not be uniquely categorized by payment networks, affecting how these transactions might be tracked or analyzed by such entities. The Department of Justice would be responsible for enforcing this rule and investigating complaints.

**CRS summary:**

> Protecting Privacy in Purchases Act
>
> This bill prohibits payment card networks from using merchant codes that distinguish firearms retailers from general-merchandise retailers or sporting-goods retailers.
>
> The Department of Justice must enforce this bill and report annually on the resulting investigations and cases.

main effect: yes / partly / no

factual error:

## 25. `119-hr-3679`: Small Business Artificial Intelligence Advancement Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-06-03 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/3679
- **CT summary written:** May 11, 2026, 1:08 AM MT (2026-05-11 07:08:55Z)
- **CRS summary quoted:** Introduced in House (action date 2025-06-03, version 00), updated Feb 18, 2026, 11:09 AM MT (2026-02-18 18:09:46Z)

**CT summary:**

> This bill would direct the National Institute of Standards and Technology (NIST) to create and share resources to help small businesses understand and use artificial intelligence. These resources would include technical standards, best practices, and case studies, and would be updated every two years. Small businesses would be affected by gaining access to voluntary tools and guidance for integrating AI into their operations.

**CRS summary:**

> Small Business Artificial Intelligence Advancement Act
>
> This bill directs the National Institute of Standards and Technology (NIST) to develop or identify resources for small businesses to address concerns relating to the use of artificial intelligence (AI). Resources must be generally applicable, technology neutral, and based on relevant voluntary international standards, among other requirements.
>
> NIST must coordinate with the Small Business Administration with respect to the distribution of these resources. NIST must also review and update the resources at least biennially.

main effect: yes / partly / no

factual error:

## 26. `119-hr-1235`: Federal Infrastructure Bank Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-02-12 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/1235
- **CT summary written:** Sep 3, 2026, 12:00 PM MT (2026-09-03 18:00:26Z)
- **CRS summary quoted:** Introduced in House (action date 2025-02-12, version 00), updated Apr 9, 2025, 12:46 PM MT (2025-04-09 18:46:18Z)

**CT summary:**

> This bill would create a new Federal Infrastructure Bank that would offer loans, loan guarantees, and equity investments for infrastructure projects like roads, bridges, and energy facilities. The bank aims to attract private investment by providing a tax credit for early investors. Both public and private entities developing qualifying, revenue-generating infrastructure projects would be affected.

**CRS summary:**

> Federal Infrastructure Bank Act of 2025
>
> This bill establishes the Federal Infrastructure Bank and the Federal Infrastructure Bank Holding Company (FIBHC). The bank shall be a wholly owned subsidiary of the FIBHC.
>
> The bank must provide equity investments, direct loans, and loan guarantees for the planning, predevelopment, design, construction, operation, or maintenance of revenue-producing infrastructure projects in the United States with sufficient revenue sources and guarantees to support the interest and principal payments to the bank. At least 10% of the loans, equity investments, and loan guarantees must be for infrastructure projects in rural areas.
>
> Entities eligible for loans, equity investments, and loan guarantees include corporations, joint ventures, states, and governmental entities. The bank is prohibited from providing funding for infrastructure projects that are owned, directed, controlled, financed, or influenced by the Chinese government or the Chinese Communist Party.
>
> The Board of Governors of the Federal Reserve System shall have oversight and supervisory authority over the FIBHC and the bank. The bank must establish an Infrastructure Guarantee Fund to cover loans and loan guarantees in the event of nonpayment by loan recipients.
>
> The FIBHC may issue equity securities, make dividend payments on the securities, and issue bonds.
>
> The bill provides for a tax credit in an amount equal to 10% of the amount a taxpayer paid to the FIBHC for an equity investment issued within three years of the formation of the FIBHC.

main effect: yes / partly / no

factual error:

## 27. `119-s-1900`: Taiwan Non-Discrimination Act of 2025

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-05-22 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/1900
- **CT summary written:** Sep 24, 2026, 6:10 PM MT (2026-09-25 00:10:26Z)
- **CRS summary quoted:** Reported to Senate (action date 2025-06-18, version 25), updated Mar 30, 2026, 1:32 PM MT (2026-03-30 19:32:26Z)

**CT summary:**

> This bill would require the U.S. Governor to the International Monetary Fund (IMF) to advocate for Taiwan's admission as a member, its participation in surveillance activities, employment opportunities for Taiwanese nationals, and access to technical assistance and training. This would affect the U.S. representatives to the IMF by directing their actions and could potentially change Taiwan's level of engagement and representation within the global financial institution.

**CRS summary:**

> Taiwan Non-Discrimination Act of 2025
>
> This bill requires actions to support Taiwan's participation in the International Monetary Fund (IMF).
>
> The U.S. Governor of the IMF must advocate for (1) Taiwan's admission into the IMF as a member, to the extent Taiwan seeks to be a member; (2) Taiwan's participation in the IMF's regular surveillance activities relating to Taiwan's economic and financial policies; (3) employment opportunities at the IMF for Taiwan nationals; and (4) Taiwan's ability to receive IMF technical assistance and training.

main effect: yes / partly / no

factual error:

## 28. `119-sres-427`: A resolution designating October 8, 2025, as "National Hydrogen and Fuel Cell Day".

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-09-30 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-resolution/427
- **CT summary written:** May 10, 2026, 7:41 PM MT (2026-05-11 01:41:19Z)
- **CRS summary quoted:** Passed Senate (action date 2025-09-30, version 55), updated Apr 8, 2026, 12:20 PM MT (2026-04-08 18:20:01Z)

**CT summary:**

> This resolution would designate October 8, 2025, as "National Hydrogen and Fuel Cell Day." This change would primarily affect individuals and organizations involved in the hydrogen and fuel cell industries by providing a dedicated day to recognize and promote these technologies. It aims to raise public awareness and celebrate the advancements in this sector.

**CRS summary:**

> This resolution designates October 8, 2025, as National Hydrogen and Fuel Cell Day.

main effect: yes / partly / no

factual error:

## 29. `119-hr-9990`: Increasing Mental Health Options Act of 2026

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2026-07-30 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/house-bill/9990
- **CT summary written:** Aug 26, 2026, 12:10 PM MT (2026-08-26 18:10:09Z)
- **CRS summary quoted:** Introduced in House (action date 2026-07-30, version 00), updated Aug 26, 2026, 9:43 AM MT (2026-08-26 15:43:13Z)

**CT summary:**

> This bill would incentivize clinical psychologists to work in underserved areas by increasing their Medicare payments. It would also allow clinical psychologists to provide certain behavioral health services under Medicare without direct physician supervision, if permitted by state law, affecting Medicare beneficiaries who receive mental health care.

**CRS summary:**

> Increasing Mental Health Options Act of 2026
>
> This bill provides for an additional payment for clinical psychologists under Medicare who provide services in designated health professional shortage areas. It also allows clinical psychologists to provide behavioral health services (in accordance with state law) for purposes of hospitalization services, home health services, and other services under Medicare.

main effect: yes / partly / no

factual error:

## 30. `119-s-1326`: Food Security and Farm Protection Act

- **Class:** shown (a CRS version was there when the CT summary was written)
- **Introduced:** 2025-04-08 · **Congress.gov:** https://www.congress.gov/bill/119th-congress/senate-bill/1326
- **CT summary written:** May 11, 2026, 4:28 AM MT (2026-05-11 10:28:36Z)
- **CRS summary quoted:** Introduced in Senate (action date 2025-04-08, version 00), updated Sep 26, 2025, 9:36 AM MT (2025-09-26 15:36:17Z)

**CT summary:**

> This bill would prevent state and local governments from imposing their own agricultural production standards on products grown in other states, if those standards are stricter than the federal or local laws where the product was grown. It would affect consumers and producers by potentially limiting states' ability to regulate food sold within their borders, and it would allow individuals and businesses to sue governments that attempt to impose such regulations.

**CRS summary:**

> Food Security and Farm Protection Act
>
> This bill restricts state and local governments from imposing certain standards or conditions on the preharvest production of agricultural products in another state. Specifically, it prohibits the imposition of such standards or conditions on products sold or offered for sale in interstate commerce if (1) the production occurs in another state, and (2) the standard or condition adds to requirements applicable under federal law and the laws of the state and locality where the product is produced.
>
> The bill also allows for a private right of action to challenge state or local regulations relating to agricultural goods sold in interstate commerce. A person may bring an action in (1) the U.S. district court for the judicial district in which the person is affected by a regulation or the person resides, operates, or does business; or (2) any other appropriate court with jurisdiction.

main effect: yes / partly / no

factual error:
