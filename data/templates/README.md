# Templates for new records

The build doesn't read these files. To add a record:

1. Copy the matching block into the data file named in each template.
2. Replace every `REPLACE` value, and delete any optional fields you don't need.
3. Cite at least one source, adding it to `sources.json` first if it's new.
4. Run `npm run build`. The build checks every reference and tells you what's wrong.

- **Ids** are lower-case kebab-case and unique within their file, e.g. `levy-matzah-bakery-ny`.
- **`kind`** for a site is one of: `synagogue`, `school`, `matzah-bakery`, `lodging` (hotel or boarding house), `kosher-restaurant`, `business` (Jewish-owned business), `bookstore`, `hospital`, `meeting-place`, `residence`.
- **`precision`** is `exact` when the address or building is documented, and `approximate` when only the street or block is known.
