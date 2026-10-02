# Jane Example

This directory contains the worked example for ApplyRail. Jane Example is a synthetic profile. She is not a real person. The files contain no personal data.

## Files

- `profile.json` holds the answers that forms ask for. These answers include name, contact details, location, work authorization and links.
- `resume.json` holds the master resume. The example renders the resume to a PDF in the plain ATS register.
- `bank.json` holds the fact bank. Tailoring may use facts only from the master resume and this file.
- `job-description.txt` holds the fictional job that the example applies to.
- `applyrail.config.json` is a starter config. `applyrail init` copies this config and the three files above into a new directory.

## Run it

```
npm run example
```

The script is `node examples/run-dry.mjs examples/jane-example`. It fills three local forms in `examples/fixtures/`. The forms resemble Greenhouse, Lever and Ashby application pages. The script runs in dry mode, so it submits nothing. It writes the resume PDF and one JSON record for each form to `out/jane-example/`.

## The live product it relates to

MatchLine (https://matchline.thecompound.tech) checks a resume against a job posting. It sells the tailored, ATS-formatted resume as a PDF. ApplyRail performs the same tailoring step with `applyrail tailor`. ApplyRail renders every resume in the same plain ATS register.

## Make it yours

1. Copy this directory: `cp -r examples/jane-example examples/my-product`.
2. Replace the values in `profile.json`, `resume.json` and `bank.json` with your own values.
3. Put the job you want in `job-description.txt`.
4. Run `node examples/run-dry.mjs examples/my-product`. The output goes to `out/my-product/`.
