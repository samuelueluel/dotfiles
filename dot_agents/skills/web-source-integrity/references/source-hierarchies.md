# Source Hierarchies

**Load this file when** selecting sources by request type, deciding whether a page is primary or secondary evidence, or classifying source exceptions and denylist entries.

## Source Selection Principle

Source quality is relational: judge the page's purpose, authorship, evidence, incentives, freshness, and fit for the claim. A domain reputation is a useful prior, not a conclusion. An official page is usually strongest for the organization's own rules or product behavior, but it is not automatically independent evidence for performance, safety, or comparative claims.

Prefer the highest-signal source that can answer the specific question. Use secondary and community sources to discover primary material, explain implementation experience, or document disagreement when they are the relevant evidence type.

## Request-Type Hierarchy

| Request type | Preferred evidence | Useful secondary or community evidence |
| --- | --- | --- |
| Software or API behavior | Current official documentation, API reference, release notes, source repository, maintainer issue or discussion | Reputable implementation report, accepted technical answer, independent reproduction |
| Open-source version or bug | Release/tag, commit, changelog, issue or pull request, maintainer documentation | Maintainer-adjacent explanation, reproducible community report |
| Standards and protocols | Standards body, RFC, specification, registry, conformance test | Implementer documentation and interoperability reports |
| Law and regulation | Statute, regulation, court opinion, regulator or official guidance | Reputable legal analysis that identifies the controlling primary text |
| Health or medicine | Public-health agency, regulator, clinical guideline, systematic review, original study | Reputable medical reporting or specialist explanation |
| Government statistics | Originating agency, dataset, codebook, methodology, revision notice | Reputable analysis that preserves the agency's definitions and limitations |
| Academic or economic finding | Original paper, working paper, data, code, replication, journal version | Systematic review, research summary, expert commentary |
| Current events | Primary statement, filing, transcript, or direct reporting plus independent reputable reporting | Established local or trade reporting; social posts as leads or direct statements |
| Product capability or price | Current official product, pricing, documentation, or terms page | Independent tests, reviews, and user reports for comparison or experience |
| Recommendation or comparison | Transparent independent methodology, comparable tests, original specifications | Multiple expert or user experiences, with incentives disclosed |
| Community practice or troubleshooting | Maintainer discussion, issue tracker, reproducible reports, high-signal technical communities | Tutorials and forums, treated as experience rather than canonical behavior |
| Historical or archival question | Primary archive, contemporaneous record, institutional collection | Scholarly synthesis that identifies its primary sources |

## Page-Level Evaluation

For each candidate page, assess:

1. **Fit:** Does the page answer this claim, or merely discuss the topic?
2. **Role:** Is it primary evidence, an official self-description, independent analysis, reporting, commentary, or user experience?
3. **Traceability:** Are author, organization, method, data, quotations, and links identifiable?
4. **Freshness:** Is the page date or version relevant to the user's time horizon?
5. **Independence:** Is it controlled by, copied from, or financially interested in another cited source?
6. **Scope:** Does the evidence cover the same population, jurisdiction, version, product, or period?
7. **Access quality:** Was the page actually retrieved, or is the result only a snippet, cached summary, or partial extraction?

## Trust Classes

### Primary and official

Use for facts directly controlled by the source: statutes, agency data, product documentation, release artifacts, original research, public statements, and archival records. Record material limitations and institutional incentives.

### Independent secondary

Use for synthesis, comparison, reporting, criticism, or interpretation. For load-bearing claims, prefer sources that show their methods and link to primary evidence. Do not count several articles repeating the same wire report or press release as independent corroboration.

### Community and user-generated

Use for implementation experience, bug discovery, local knowledge, firsthand statements, and evidence of disagreement. Validate factual or consequential claims against stronger sources where possible. A community source can be the primary evidence for what a user or maintainer said there.

### Discovery-only or normally avoid

Deprioritize SEO listicles, anonymous aggregators, AI-generated summaries, scraped copies, unattributed reposts, affiliate rankings, link farms, and pages whose evidence cannot be traced. They may reveal search vocabulary or a lead, but generally should not carry a material claim alone.

### Hard-deny category

Maintain a small local denylist for confirmed phishing, malware, impersonation, fabricated-citation services, and sources that violate the user's access or safety constraints. A denylist entry should have a reason and review date; avoid treating a transient broken page or unpopular viewpoint as a security denylist entry.

## Exceptions

- A company source is appropriate for its own API, pricing, terms, feature availability, or public statement; pair it with independent evidence for performance or comparative superiority.
- A government source is authoritative for its data or policy but may still embody definitional, political, or methodological choices; preserve those qualifications.
- A social post or forum entry can be primary evidence of the author's statement or reported experience, but not automatically of the underlying fact.
- A secondary source may be preferable when the primary material is inaccessible, incomprehensible without specialist context, or itself the object of analysis. Label the evidentiary limitation.
- A source can be useful despite being old when the claim is historical or the page documents a version-specific state. For fast-changing technical claims, verify the current version separately.

## Corroboration

Count corroboration by independent evidence chains, not URL totals. Multiple pages that copy one announcement form one chain. For a comparison, seek evidence for each side. For a contested claim, search explicitly for credible counterevidence before calling it settled.
