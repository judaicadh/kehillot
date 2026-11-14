# Contributing to Kehillot

Thank you for helping build Kehillot. There are two ways to contribute.

## 1. Suggest an addition or correction (no coding)

Use the forms under **Issues → New issue**, or the "Suggest…" links throughout the site:

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
