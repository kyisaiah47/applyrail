# ApplyRail

ApplyRail is an open-source job application agent from [Compound Labs](https://thecompound.tech). It finds job postings, queues them, fills each employer's application form from your profile, and reviews every filled form before it submits. It submits only when the review passes.

You run it on your own machine, with your own profile, your own resume and your own model.

## What ApplyRail does

- **Fills employer application forms.** The ATS drain opens each queued job on the employer's own applicant tracking system and fills the form: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Jobvite, BambooHR, Rippling, Recruitee, Teamtailor, Breezy and other careers pages. It works one employer at a time, so one company never sees two sessions from you at once.
- **Reviews every form before it submits.** The presubmit review reads the finished form back from the page and checks it against your profile. It blocks a required field left empty, a value an autocomplete corrupted, a work authorization or sponsorship answer with the wrong polarity, a different city with the same first word, your resume in the cover letter slot, an email or a URL in the wrong box, an instruction inside a question that the answer does not follow, and a "why this company" answer that never names the company. A blocked field is filled again once or twice, and the form is reviewed again. A review that cannot run is a block.
- **Has a `--dry` mode.** `--dry` fills and reviews every form and submits nothing. `--submit` is the only way anything is sent.
- **Answers from your profile.** Every answer comes from your profile file, from your own list of answers, or from your model working only from your profile. A question the profile cannot answer is reported to you, never guessed. EEO questions are answered with your profile's words, and a decline matches whichever decline wording the form offers.
- **Tailors your resume per job.** Your model selects and rewords bullets from your master resume and your fact bank, one composition per job. A validator rejects any change to employers, titles, dates or education, any number not in your sources, any skill not in your sources, and any sentence about something you have not done. A rejected composition falls back to your master resume. The PDF is written in a plain ATS register, so text extraction reads your name on line 1.
- **Harvests postings.** Harvesters read company job boards (Greenhouse, Lever and Ashby public APIs), Y Combinator companies, work-from-anywhere boards (Remote OK and Working Nomads by default; Remotive, Himalayas and Jobicy when you turn them on), Dice, Indeed, ZipRecruiter and Wellfound. The Dice, Indeed, ZipRecruiter and Wellfound harvesters are off until you turn them on. Each harvester keeps only postings that apply on the employer's own site and queues the employer's URL.
- **Includes LinkedIn as an opt-in harvester.** The LinkedIn harvester is off by default. When you turn it on, it reads job listings in your own browser, keeps the "Apply on company website" link, and routes the job to the employer's ATS. It never clicks Apply. ApplyRail has no LinkedIn Easy Apply.
- **Keeps one queue.** Every posting records where it was found, its ATS URL, its state and its history. A job is never applied to twice.
- **Offers optional board lanes.** Board lanes apply through a board's own flow (Indeed Apply, ZipRecruiter 1-Click, Wellfound, Dice Easy Apply, YC Work at a Startup) in your own signed-in browser. Every lane is off by default.
- **Stops instead of bypassing.** A captcha that wants a person, a block page, a rate limit or a sign-in wall stops the run. The item is marked `stopped` with what was seen. ApplyRail never solves a captcha, never hides that it is automated, and never signs in for you. A form that carries an anti-automation question ("decode this string", "if you are an AI") is skipped and nothing on it is filled.
- **Paces itself.** Delays between actions, delays between applications and daily caps per platform are all config values.
- **Uses your model.** One provider interface covers OpenAI, Anthropic, Gemini, any OpenAI-compatible base URL (including a local model such as Ollama), and any command-line tool that reads a prompt on stdin.
- **Scaffolds a dashboard.** `applyrail new-app <dir> --app console|simple|both` writes a Next.js app that reads your queue. Console is a dense working view. Simple is a roomier view with details behind disclosures. Both adds a welcome dialog and a view switch in the footer.

## Who carries the risk

The person who runs ApplyRail carries every risk to their own accounts. Job boards and applicant tracking systems publish terms that restrict automated access, and several prohibit automated applications outright. Their clauses are quoted below with the date each was fetched. Read them before you turn anything on. A board can limit, suspend or close your account, and an employer can reject an application it believes was automated.

A captcha stops the run. ApplyRail does not solve, skip or work around it. The job is left as `stopped`, and you finish it yourself or move on.

## Install

```
npm install -g applyrail
npm install -g puppeteer     # needed to fill live forms in a browser
```

Node.js 20 or newer is required. `jsdom` is needed only for filling local HTML files.

## Quick start

```
mkdir my-search && cd my-search
applyrail init                 # writes applyrail.config.json, profile.json, resume.json, bank.json
# replace the example values with your own
applyrail doctor               # checks the config, the profile and the model settings
applyrail harvest              # runs the harvesters that are on and queues what passes the screen
applyrail queue list
applyrail drain --dry          # fills and reviews each queued form, submits nothing
applyrail drain --submit       # fills, reviews and submits
```

`applyrail apply <url> --dry` applies to one URL. `applyrail queue retry <id>` puts a job back in the queue.

## The worked example

The example applies a synthetic profile, Jane Example, to a fictional job on three local HTML forms built like Greenhouse, Lever and Ashby application pages. It runs in `--dry` mode and submits nothing.

```
git clone https://github.com/kyisaiah47/applyrail && cd applyrail
npm install
npm run example
```

It renders Jane's master resume to a PDF, fills all three forms, and prints every filled field and the review's verdict. Two questions on the Ashby form need written answers. By default an example stub writes them from Jane's facts and says so. `node examples/run-dry.mjs --gemini` asks Gemini instead and needs `GEMINI_API_KEY`.

The files are in `examples/`: `jane-example/` holds the profile, the master resume, the fact bank, a job description and a config, and `fixtures/` holds the three forms. None of it is personal data.

## Configuration

`applyrail.config.json` sits next to your profile. Paths are relative to it.

| Key | What it sets |
| --- | --- |
| `profile`, `resume`, `bank` | your profile, your master resume (JSON) and your fact bank |
| `files.resume`, `files.coverLetter` | a resume PDF to upload as is; without one the master resume is rendered |
| `model` | the provider for written answers, tailoring and the optional model review |
| `screen` | title deny and allow lists, accepted locations, a minimum description length |
| `harvest.<source>.enabled` | which harvesters run; `linkedin` runs only when this is `true` |
| `drain` | `width` (parallel employers), `tailor`, `modelReview`, `allowAccountHosts` |
| `pacing` | delays and daily caps |
| `boardLanes.<board>.enabled` | which board lanes may run; all are `false` by default |
| `browser.cdpUrl` | your own Chrome, for browser harvesters and board lanes |

## The profile

`profile.json` holds the facts forms ask for: name, email, phone, location, links, current role, years of experience, education, work authorization, sponsorship, relocation, salary expectation, notice period, consents and EEO answers. Two lists let you go further:

- `answers` is a list of `{ "match": "...", "answer": "..." }`. A match is text or a `/regex/`. Your answers are tried before any rule.
- `facts` is a list of plain sentences about you. Your model may use them, and nothing else, for written answers.

Work authorization questions are read for their polarity. "Do you require sponsorship?", "Are you authorized to work?" and "Are you authorized to work without sponsorship?" each get the answer your profile implies.

## Models

```json
{ "model": { "provider": "gemini", "model": "gemini-2.5-flash" } }
{ "model": { "provider": "openai", "model": "gpt-4o-mini" } }
{ "model": { "provider": "anthropic", "model": "claude-3-5-haiku-latest" } }
{ "model": { "provider": "openai-compatible", "baseURL": "http://localhost:11434/v1", "model": "llama3.1" } }
{ "model": { "provider": "command", "command": ["llm", "-m", "my-model"] } }
```

Keys are read from `GEMINI_API_KEY`, `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`, or from the variable named in `apiKeyEnv`. Only the chosen provider's key is read. Without a model, ApplyRail still fills everything the profile answers, uses your master resume, and reports each written question as unanswered.

## Commands

| Command | What it does |
| --- | --- |
| `applyrail init [dir]` | writes a starter config, profile, resume and fact bank |
| `applyrail doctor` | checks the config, the profile, the model settings and the browser packages |
| `applyrail harvest [--only a,b] [--cdp url]` | runs the harvesters and queues what passes the screen |
| `applyrail queue [stats\|list\|add <url>\|show <id>\|retry <id>]` | reads and edits the queue |
| `applyrail drain --dry\|--submit [--limit n] [--cdp url] [--headed]` | applies to queued jobs |
| `applyrail apply <url> --dry\|--submit` | queues one URL and applies to it |
| `applyrail fill <file.html>` | fills a local HTML form in `--dry` mode and prints the review |
| `applyrail tailor --job <jd.txt> [--title t] [--company c]` | tailors your resume to one job description |
| `applyrail lane <board> --dry\|--submit --cdp <url>` | runs one board lane in your signed-in browser |
| `applyrail new-app <dir> --app console\|simple\|both` | writes a Next.js dashboard of your applications |

## Queue states

| State | Meaning |
| --- | --- |
| `queued` | waiting to be applied to |
| `screened_out` | removed by the title, location or description screen |
| `filling` | a drain is filling the form now |
| `dry_filled` | filled and reviewed in `--dry` mode; nothing was submitted |
| `needs_input` | a required question has no answer in your profile |
| `review_blocked` | the presubmit review blocked the form |
| `manual` | needs you: a Workday or iCIMS account, an unresolved link, no submit button |
| `skipped` | the employer asks applicants not to use automation, or the posting does not apply |
| `stopped` | a captcha, a block page or a rate limit stopped the run here |
| `submitted` | submitted; a submit with no confirmation text also counts and is never retried |
| `failed` | an error; `applyrail queue retry <id>` queues it again |
| `closed` | the posting is gone |

## Board and ATS terms

Each clause below was fetched on 2026-10-02 from the URL shown and is quoted exactly. Terms change. Check the current page before you run a harvester or a lane against a site.

### Indeed

Source: https://www.indeed.com/legal. Date as printed: "Last Updated: September 29, 2026". Fetched on 2026-10-02.

> Limits: To maintain the quality of the Site and reduce fraud and spam, Indeed in its sole discretion may impose limits on your use of the Site. This may include limiting – after notice on the Site – the number of daily job applications you can submit through Indeed. Further, you acknowledge that Indeed may require that users verify their email address or phone number to use the site or apply to jobs. Use of any automation, scripting, or bots to automate the Indeed Apply process outside of Indeed’s official vendors and tooling is prohibited.

> Access the Site through any means other than the public interfaces provided by Indeed;

> Use any automated system (bots, scrapers, spiders, AI or Agentic AI) to access, data-mine, or submit content to the Site, in bulk or otherwise, without Indeed’s express written permission (we conditionally grant permission to crawl the Site solely as outlined in our robots.txt file). You may not crawl, scrape, extract data from, reproduce, duplicate, copy, sell, exploit, trade or resell any part of the Site or access the Site for the development, training, fine-tuning, or improvement of any third-party machine learning model, artificial intelligence (AI) system, or any related software program, model, algorithm, or generative AI tool;

> Submit job applications or other User Content by automated means, in bulk or otherwise, other than by automated tools that the Site explicitly offers or that have been otherwise agreed to in writing with Indeed;

> Indeed reserves the right to use technical measures to detect, investigate, or prevent unauthorized automated access or activity on the Site. Indeed reserves the right to monitor all activity and communications on or through the Site and to not pass on or deliver any message or communication that may be malicious, spam, fraudulent, or unwanted, or for any other violation of these Site Rules. This includes webforms, links, or attachments of any type, scripts, macros, or any other form of code. By using the Site, you consent to this monitoring and moderation of your activities and communications. You agree the determination of what constitutes spam, unwanted or objectionable content, or a violation of the Site Rules is in Indeed’s sole discretion. Bribing an Indeed employee to remove content will result in the company’s removal from the Site.

> Third Party Automations: You agree that all general Site access and use prohibitions in the Terms, including those against scraping, bots, and other automated activity, remain in full effect. However, Indeed may, at our sole discretion, offer you the ability to connect your Indeed Account to third-party AI platforms (“Permitted AI Connector”). You must comply with any Indeed account creation and login requirements we establish for use of a Permitted AI Connector to access the Site. Site functionalities available through any Permitted AI Connector may be limited in our sole discretion. Any Permitted AI Connector is in Beta and subject to our Beta Program terms. Any use of the Site through a Permitted AI Connector must strictly comply with the Terms, and Indeed reserves the right to suspend or terminate access at any time. Your use of a third-party AI platform through a Permitted AI Connector is a Third Party Service and is subject to the third-party AI platform’s terms. Indeed does not own, control nor have any responsibility or liability for any third-party AI platform you choose to link to your Indeed Account through a Permitted AI Connector, including how information obtained from the Site may be presented to you by such third-party AI platform. By linking your account through a Permitted AI Connector, you authorize Indeed to share your account data and User Content with such third-party AI platform.

> a. General: If you are a user in the United States or Canada and are 18 years of age or older, Indeed may offer you the opportunity to activate our ‘Apply For Me’ tool. Activating this tool enables applications to be auto-submitted to Job Ads based on your Profile information and job preferences. You can disable ‘Apply For Me’ at any time, but doing so does not withdraw or reverse submitted applications. You understand your information may be shared as an application with any Employer, subject to our Privacy Policy when you use this tool.

The Indeed harvester and the Indeed board lane are off by default. The board lane automates Indeed Apply, which the first clause above prohibits.

### LinkedIn User Agreement, section 8.2

Source: https://www.linkedin.com/legal/user-agreement. Date as printed: "Effective on November 3, 2025". Fetched on 2026-10-02.

> Develop, support or use software, devices, scripts, robots or any other means or processes (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the Services, including profiles and other data from the Services;

> Override any security feature or bypass or circumvent any access controls or use limits of the Services (such as search results, profiles, or videos);

> Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages, create, comment on, like, share, or re-share posts, or otherwise drive inauthentic engagement;

The LinkedIn harvester is off by default and runs only when harvest.linkedin.enabled is true. It reads the "Apply on company website" link and never clicks Apply. ApplyRail has no LinkedIn Easy Apply lane.

### ZipRecruiter Terms of Use

Source: https://www.ziprecruiter.global/en/terms (https://www.ziprecruiter.com/terms redirects there). Date as printed: "Effective Date: August 11, 2026". Fetched on 2026-10-02.

> “crawling” or "scraping", whether by automated, manual, or other non-automated means, or otherwise using any automated means (including, without limitation, “bots,” “scrapers,” and “spiders”), to view, access or collect information or content from the Services, or using any part of the Services or content to train a machine learning or AI model or otherwise ingesting content or any portion of the Services into a machine learning or AI model;

> using any automated system or means, including without limitation “bots,” "robots," "spiders," "offline readers," “scrapers,” etc., to view or access the Services in a manner that sends more request messages to the ZipRecruiter servers than a human can reasonably produce in the same period of time by using a conventional on-line web browser (except that ZipRecruiter grants the operators of public search engines revocable permission to use spiders to copy materials from ZipRecruiter.com for the sole purpose of, and solely to the extent necessary for, creating publicly available searchable indices of the materials, but not caches or archives of such materials);

> accessing any content on the Services through any technology or means other than those provided or authorized by the Services;

> bypassing the measures we may use to prevent or restrict access to the Services, including without limitation, features that prevent or restrict use or copying of any content or enforce limitations on use of the Services or the content therein;

These quotes are from the terms for users outside the EEA, Switzerland and the UK. The ZipRecruiter harvester and board lane are off by default.

### Workday website terms

Source: https://www.workday.com/en-us/legal/site-terms.html. Date as printed: "Last Updated: 08/13/2026". Fetched on 2026-10-02.

> These Terms of Service (“Terms”) apply to your access to and use of (a) the website located at www.workday.com and all associated web pages, websites and corresponding social media pages, (b) any web pages, websites, corresponding social media pages, materials, or other documents (including all content therein) that directly reference these Terms, (c) the Community (as defined below), and (d) the Workday APIs (as defined below) ((a)-(d) collectively, the “Sites”) provided by Workday, Inc., its subsidiaries and affiliates (each “Workday”, “we”, “us” or “our”).

> Use any data mining, robots or similar data gathering or extraction methods designed to scrape or extract data from our Sites;

> Develop or use any applications that interact with our Sites without our prior written consent;

> Bypass or ignore instructions contained in our robots.txt file; or

An employer's Workday career site is a separate tenant. The tenant checked on 2026-10-02 linked only to the employer's applicant privacy policy, not to these terms. ApplyRail fills a Workday form only when you are already signed in to that employer's tenant in your own browser, and it tries each job once.

### Greenhouse (MyGreenhouse User Agreement)

Source: https://my.greenhouse.io/users/agreement. Date as printed: "Effective Date: January 29, 2025". Fetched on 2026-10-02.

> Your Account. You agree to: (a) comply with all applicable laws, including, without limitation, privacy laws, intellectual property laws, export control laws, and regulatory requirements; and (b) provide accurate information (including contact information) within your account and keep it updated. You agree that you will not (and will not assist any third party to): (s) misrepresent your identity or create an account for anyone other than yourself; (t) attempt to use another person’s account; (u) provide content or information that violates the law or anyone’s rights; (v) override any security features or bypass or circumvent any access controls or use limits of the Services; (w) access or use the Services for purposes of developing or offering competitive products or services; (x) reverse engineer, decompile, disassemble, decipher or otherwise attempts to derive the source code for the Services or any related technology; (y) rent, lease, loan, trade, sell/re-sell or otherwise monetize the Services or related data or access to the same; or (z) use automated means, including spiders, robots, crawlers, or similar means or processes to access or use the Services. You are responsible for anything that occurs through your account unless you close your account or report misuse.

This agreement covers the MyGreenhouse candidate service. No candidate terms were found for applying on an employer's job-boards.greenhouse.io page. Also checked: https://www.greenhouse.com/legal and https://www.greenhouse.com/privacy-policy.

### Dice Terms and Conditions

Source: https://www.dice.com/about/terms-and-conditions. Date as printed: "LAST UPDATED: 12/03/2025". Fetched on 2026-10-02.

> 8.2 While using the Site or Site-related services, you agree not to do any of the following without our prior written authorization:

> j) Use any search engine, software, tool, electronic storage or retrieval device, agent or other device or mechanism, including without limitation browsers, spiders, robots, avatars, or intelligent agents (collectively "Devices") that is not approved by Dice to navigate, search or store information from the Site. Approved Devices include those made available by Dice on the Site, or other generally available third-party web browsers, e.g., Mozilla Firefox, Google Chrome, Microsoft Internet Explorer, or generally available search engines, e.g., Google or Bing.

> p) Respond to a job listing on behalf of anyone other than yourself.

> aa) Use any robot, spider, site search/retrieval application, or other manual or automatic device or process to retrieve, index, "data mine," or in any way reproduce or circumvent the navigational structure or presentation of the Site or its contents.

The Dice harvester and the Dice board lane are off by default.

### Wellfound

Source: https://wellfound.com/terms. Date as printed: "These General Terms were last updated on June 5, 2020.". Fetched on 2026-10-02.

> copy, disclose or distribute Content except as expressly permitted by the Terms (including through the use of automated or non-automated harvesting, collection or “scraping”) or otherwise use the Site or Services for competitive purposes;

> use any automated system (including a spider, robot, or offline reader) to access the Site or Services in a manner that takes more bandwidth or produces greater load on Wellfound's network or servers than a human can reasonably produce in the same period of time by using a conventional on-line web browser (except Wellfound grants public search engines revocable permission to copy materials from the publicly available searchable indices of the materials, excluding any caches or archives of such materials);

The Wellfound harvester and board lane are off by default.

### Y Combinator (Work at a Startup links to these terms)

Source: https://www.ycombinator.com/legal. Date as printed: "Last Updated September 2026 (printed under the Privacy Policy heading; the Terms of Use section prints no date)". Fetched on 2026-10-02.

> In connection with your use of the Site you will not engage in or use any data mining, robots, scraping or similar data gathering or extraction methods. If you are blocked by Y Combinator from accessing the Site (including by blocking your IP address), you agree not to implement any measures to circumvent such blocking (e.g., by masking your IP address or using a proxy IP address).

> obtain or attempt to access or otherwise obtain any materials or information through any means not intentionally made available or provided for through the Site.

The YC harvester reads the public yc-oss company list hosted on GitHub and each company's own job board API. It does not read ycombinator.com. The YC Work at a Startup board lane is off by default.

### Remotive

Source: https://remotive.com/terms-of-use and https://remotive.com/remote-jobs/api. Date as printed: "Last updated: March 2026 (site terms); the API page prints no date". Fetched on 2026-10-02.

> Scrape, crawl, or use automated means to access the Site or extract data without our written permission.

> Please note that API documentation and access is granted so that developers can share our jobs further. Please do not submit Remotive jobs to third Party websites, including but not limited to: Jooble, Neuvoo, Google Jobs, LinkedIn Jobs.

> Please link back to the URL found on Remotive AND mention Remotive as a source in order to Remotive to get traffic from your listing. If you don't do that, we'll terminate your API access, sorry!

> Please note that there is absolutely no need to request Remotive Job data too frequently. Typically, you only need to GET Remotive job data through this API a couple of times a day (we advise max. 4 times a day). Our data is not changing much faster than that anyway. Note that excessive requests (more than 2x per minute) will be blocked.

Remotive is off by default. Finding the employer link means opening a remotive.com page, which the site terms restrict. When you turn it on, ApplyRail polls the API at most once every 6 hours, waits 30 seconds between page requests, and keeps the Remotive URL as the source.

### Remote OK

Source: https://remoteok.com/api and https://remoteok.com/legal. Date as printed: "Updated July 20, 2026 (site terms); the API notice prints no date". Fetched on 2026-10-02.

> API Terms of Service: Please link back (with follow, and without nofollow!) to the URL on Remote OK and mention Remote OK as a source, so we get traffic back from your site. If you do not we'll have to suspend API access.

> You agree to link back with a web hyperlink or in-app hyperlink to our site on the page or app screen where you use the data from our APIs or site.

Remote OK is on by default. ApplyRail keeps the Remote OK URL as each posting's source, and the dashboard links to it.

### Himalayas

Source: https://himalayas.app/api and https://himalayas.app/terms. Date as printed: "Current as of Oct 02, 2026". Fetched on 2026-10-02.

> Our public JSON APIs can be used to backfill other remote job boards, power job search experiences, populate internal dashboards, or feed AI agents and automation workflows.

> Anyone can use the interface, but please link back to the URL found on Himalayas AND mention Himalayas as the original source. Please do not submit Himalayas jobs to third-party websites, including but not limited to Jooble, Neuvoo, Google Jobs, or LinkedIn Jobs.

> 30. You may not use data mining, robots, screen scraping, or similar automated data gathering, extraction or publication tools on this Site (including without limitation for the purposes of establishing, maintaining, advancing or reproducing information contained on our Site on another website or in any other publication), without Himalayas' prior written approval.

> Use bots or other automated methods to access the Services, add or download contacts, send or redirect messages;

Himalayas is off by default. The employer link is on a himalayas.app page, which the site terms restrict.

### Jobicy

Source: https://jobicy.com/jobs-rss-feed and https://jobicy.com/terms-and-conditions. Date as printed: "Updated October 1, 2026 (API page); the last update to the terms was July 2026". Fetched on 2026-10-02.

> Keep Jobicy as the original source and preserve the canonical Jobicy job URL when displaying listings.

> Polling a few times per day is normally sufficient and must not exceed once per hour.

> Thanks for using Jobicy API! Please ensure Jobicy is clearly credited with a direct link to the source, and all application buttons redirect to the original job URL provided in this feed. That’s all! You might be building something amazing, we wish you the best of luck!

> e) Harvest or scrape data (other than via our official API under its terms);

Jobicy is off by default. When you turn it on, ApplyRail polls the API at most once an hour.

### We Work Remotely

Source: https://weworkremotely.com/api-terms-and-guidelines. Date as printed: "no date printed". Fetched on 2026-10-02.

> By using the API, we require you to not bypass the We Work Remotely interface when applying for a job. You are welcome to pull in job details like company name, logo and description, but applying must be routed through the weworkremotely.com website. Any violations of this will be shut down.

> The only We Work Remotely data you may use in your product or application is that which is exposed via our API. Scraping, copying, saving, or storing our data is strictly prohibited and against our Terms of Service.

ApplyRail does not read We Work Remotely, because these terms require applying through weworkremotely.com.

### Lever

No candidate-facing clause about automated access was found on 2026-10-02. The published terms are contracts with business customers. Checked: https://www.lever.co/legal, https://www.lever.co/legal/terms-of-service ("Last updated August 25, 2023"), https://www.employinc.com/terms-of-service/ ("These Terms of Service were last updated February 19, 2025.") and the footer of a jobs.lever.co board.

### Ashby

No candidate-facing clause about automated access was found on 2026-10-02. The published terms are a contract with business customers. Checked: https://www.ashbyhq.com/resources/terms ("Last updated September 29, 2025"), https://www.ashbyhq.com/resources/privacy ("Last updated September 24, 2025") and the footer of a jobs.ashbyhq.com board.

### Working Nomads

No clause about automated access was found on 2026-10-02 at https://www.workingnomads.com/terms-and-conditions ("Last updated: 11 March 2025"). Its public API at https://www.workingnomads.com/api/exposed_jobs/ carries no notice. Working Nomads is on by default.

## Development

```
npm install
npm test                       # node:test; uses a stub provider, never a paid key
npm run example
APPLYRAIL_SCRUB_KEY=... node scripts/scrub-gate.mjs
```

One test calls the free Gemini API, and only when `GEMINI_API_KEY` is set. No test reads `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.

The scrub gate runs in CI and fails closed. It refuses personal email addresses, machine paths, account and project ids, key-shaped strings, stealth plugins, services that solve captchas, and webdriver overrides. It also refuses the maintainers' personal data through keyed digests, so the repo never holds the data itself. That check needs a key only the maintainers hold, so on a pull request from a fork the scrub job fails until a maintainer runs it.

## License

MIT. Copyright (c) 2026 Compound Labs.
