"""Import article-link metadata from downloaded Occident volume indexes.
Usage: python3 scripts/import-occident.py /path/to/indexes (1.html … 10.html).
No article text is copied. Original index URLs and import date are retained.
"""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, quote
from pathlib import Path
import json, re, sys, hashlib, datetime
class Links(HTMLParser):
    def __init__(self): super().__init__(); self.href=None; self.text=[]; self.links=[]; self.rows=[]
    def handle_starttag(self,tag,attrs):
        if tag=='tr': self.rows.append({'text':[], 'links':[]})
        if tag=='a': self.href=dict(attrs).get('href'); self.text=[]
    def handle_data(self,text):
        if self.href: self.text.append(text)
        if self.rows: self.rows[-1]['text'].append(text)
    def handle_endtag(self,tag):
        if tag=='a' and self.href:
            entry=[self.href,' '.join(' '.join(self.text).split()),'']; self.links.append(entry)
            if self.rows:self.rows[-1]['links'].append(entry)
            self.href=None
        if tag=='tr' and self.rows:
            row=self.rows.pop(); context=' '.join(' '.join(row['text']).split())
            for entry in row['links']: entry[2]=context
rows={}
for volume in range(1,11):
    source=f'http://www.theoccident.com/Occident/volume{volume}/contents.html'
    parser=Links(); parser.feed((Path(sys.argv[1])/f'{volume}.html').read_text(errors='replace'))
    count=0
    for href,title,context in parser.links:
        url=quote(urljoin(source,href),safe=":/?#[]@!$&'()*+,;=%"); path=urlparse(url).path
        match=re.search(r'/volume(\d+)/([a-z]+)(\d{4})/([^/]+)\.(?:html?|pdf)$',path,re.I)
        if not match or match[4].lower()=='index' or not title: continue
        if urlparse(url).hostname not in ('www.theoccident.com','theoccident.com'): continue
        month=match[2].lower()[:3]; months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
        if month not in months: raise ValueError(url)
        date=f'{match[3]}-{months.index(month)+1:02}'
        originalLabel=title
        if re.fullmatch(r'(?:Part\s+|No\.?\s*)?[IVX\d() .,–—-]+', title, re.I) and context and context!=title: title=context[:350]
        key=url.lower()
        if key not in rows: rows[key]={'id':hashlib.sha256(url.encode()).hexdigest()[:16],'title':title,'linkLabel':originalLabel,'url':url,'volume':volume,'date':date,'indexUrl':source}
        count+=1
    if not count: raise ValueError(f'No articles in volume {volume}')
output={'title':'The Occident: article-link catalogue','source':'http://www.theoccident.com/Occident/index.html','imported':datetime.date.today().isoformat(),'coverage':'Links present in the ten volume indexes (1843–1853); not the full 1843–1868 run. Dates are issue months derived from the archive paths. Titles are transcribed from link labels; some labels are abbreviated. Article text has not been imported.','articles':sorted(rows.values(),key=lambda a:(a['date'],a['url']))}
Path(__file__).resolve().parents[1].joinpath('data/occident-articles.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(f'Imported {len(rows)} article links from ten indexes')
