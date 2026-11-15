# Contributing to Kehillot

Thank you for helping build Kehillot. You can use the public contribution desk, the GitHub forms, or edit the data directly.

## 1. Suggest an addition or correction (no coding)

The site's **Contribution desk** at `/contribute/` lets you prepare a sourced suggestion without a GitHub account. If online delivery has not been configured, it downloads a text file for you to share with an editor; downloading does **not** send the contribution to the project. A configured inbox receives suggestions for manual editorial review.

The desk also links to the existing forms under **Issues → New issue** for those who prefer GitHub:

| Form | For |
|---|---|
| Suggest a place in a city | synagogue buildings, schools, matzah bakeries, hotels and boarding houses, kosher restaurants, Jewish-owned businesses, bookstores and other sites |
| Suggest a cemetery | Jewish burial grounds |
| Suggest a person or clergy member | rabbis, hazanim, ministers, shochtim, mohalim, shamashim, communal leaders, proprietors |
| Suggest a congregation | congregations active between about 1840 and 1870 |
| Suggest a correction | anything wrong or missing on an existing page |

**What makes a good suggestion**

- **Cite a source** that someone else could check: book, newspaper, directory, census, synagogue record or archive, with date and page. Family memory is a welcome lead but needs a documentary source to be published.
- **Say how certain you are.** Choose "Medium" when sources disagree or a date is approximate.
- **Give a location if you can**, even an approximate one.
- **No private information about living people.** Suggestions and GitHub usernames are public.
- Contributions are published under **CC BY 4.0**. Summarise and cite, rather than pasting long passages from copyrighted works.

You'll be credited on the record and on the Contributors page, with your ORCID iD if you give one.

## 2. Edit the data directly

Records live in `data/*.json`; templates are in `data/templates/`. Run `npm run build`: the build checks every reference, date and source and refuses to publish broken data. Open a pull request with your changes.

## For editors: reviewing suggestions

1. **Check the suggestion against its source.** Ask questions in the issue if needed.
2. **Add the `accepted` label.** A workflow converts the form into a record, runs the full build, and opens a pull request that closes the issue. Only people with triage access or above can add labels, so only editors can trigger it.
3. **Review the pull request.** Its checklist lists anything the converter couldn't match. For example:
   - a person not yet in Kehillot (kept in the note rather than guessed);
   - a city that needs adding to `data/places.json`;
   - a site with no coordinates (placed at the city centre with `precision: "city"`).

   If the build didn't validate, the pull request opens as a draft with the errors shown.
4. **Merge.** The site redeploys automatically.

Corrections (`correction` label) are not converted automatically: apply them by hand in a pull request.

If you add a city, a place type or a clergy title, regenerate the forms so their dropdowns match:

```bash
npm run build && npm run forms
```

## Connecting account-free submissions

Set `contribute.endpoint` in `site.config.json` to an HTTPS form inbox endpoint that accepts ordinary HTML form POSTs. For example, a registered Form.taxi inbox can receive the desk's named fields. Rebuild after setting it. Until then, the desk offers only the explicitly labelled local download. The form provider handles delivery confirmation; the website does not report success without delivery. Configure spam controls, allowed origins, and retention in the inbox provider before enabling it.

An editor checks the source and manually creates or updates records from inbox submissions. The existing GitHub `accepted` label automation still applies only to GitHub issue forms; the public desk does not auto-create issues or publish records.

## Optional AI screening

A small server-side service could check submissions before editorial review using a free-tier model such as Llama on Cloudflare Workers AI. Suggested sequence: validate fields and spam controls → save to a review inbox → ask the model for flags and reasons → editor checks the cited source → existing validated publishing workflow. Keep submissions even when the model is unavailable or its daily quota is exhausted.

AI screening should flag off-topic material, missing citations, likely spam, possible duplicates and contradictions with existing records. A citation's presence is not proof that it exists or supports the claim. Supply source text when available; otherwise report it as unverified. Treat all submission text as untrusted evidence, never as instructions, and do not give the model publishing credentials. Never automatically accept or silently discard a suggestion based on its score.

AI screening is a proposed integration, not enabled in this repository. It needs a backend/inbox and a configured AI account; credentials must stay server-side. Cloudflare's daily free allowance and model eligibility are documented at https://developers.cloudflare.com/workers-ai/platform/pricing/.
