#!/usr/bin/env python3
"""Rebuild the supplied manuals as page-addressable, reproducible local RAG data.
Usage: python scripts/build_knowledge.py --input /path/to/attachments
Requires pdftotext and pypdf. Original files are copied without modification.
"""
import argparse, gzip, hashlib, json, os, re, shutil, subprocess, tempfile, unicodedata, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'moleg-2026-10-24-v1'
DEFS = [
 ('local-ordinance-2026','01_', '자치법규 입안 길라잡이','2026판','2026-09',571,'462f645af7974344e5a3ec60f47f8c9f32b8f3c35482490c5d12d54be3214a72','https://www.moleg.go.kr/board.es?act=view&bid=0007&list_no=158476&mid=a10404000000','https://www.moleg.go.kr/boardDownload.es?bid=0007&list_no=158476&seq=2','조례·규칙의 위임 범위, 체계, 개정 방식, 부칙과 절차'),
 ('legislation-2026','02_', '법령 입안·심사 기준','2026 표지 · 2025.12 개정','2025-12',880,'5f8f02e62145f077cc45f759904ce8cd59cd6a5d40b96ebe4704927624abc4b0','https://www.moleg.go.kr/menu.es?mid=a10105030000','https://www.moleg.go.kr/boardDownload.es?bid=ATT&list_no=147288&seq=1','법령의 입안·심사 원칙, 실체 규정과 개정·부칙 작성'),
 ('administrative-rules-2025','03_', '행정규칙 입안·심사 기준','2025판','2025-12',152,'d7a13929a9f69c80e892c2ad15da095889eca18ac1411c9336c8cb605c7901e5','https://www.moleg.go.kr/menu.es?mid=a10103030000','https://www.moleg.go.kr/boardDownload.es?bid=ATT&list_no=147094&seq=1','훈령·예규·고시의 성격, 수권, 발령과 재검토 적용 범위'),
 ('plain-language-2026','04_', '알기 쉬운 법령 정비기준','제10판 수정·증보판(2026)','2025-12',394,'38553647aeaf960f32906eab2129b2fa55aefbaea25ff6ee084f5f91b7572094','https://opinion.lawmaking.go.kr/lmKnlg/abRprStd','https://opinion.lawmaking.go.kr/file/static/pdf/CF1711','뜻이 달라지지 않는 용어·문장 정비와 내용 변경 검토'),
 ('opinion-request','05_', '자치법규 의견제시 요청서','공식 게시 HWPX 서식','2026-10-23',None,'3bb19d6fdd91c8da692794ed4270fca3220f086023dee408fec888c24a32efdf','https://www.moleg.go.kr/menu.es?mid=a10107010000','https://www.moleg.go.kr/boardDownload.es?bid=ATT&list_no=135360&seq=1','질의 요지·배경·대립 의견·요청 자격을 준비하는 원본 서식'),
 ('source-guide','출처_', '출처 및 파일 안내','사용자 제공 안내문','2026-10-24',None,'fd394dcb283ac5a3ab9da0a8b3ec45a70944fcc4b1d0c84efb7a467c2560cdf4',None,None,'수집·제공 시점, 원본 지문과 공식 출처를 정리한 안내문'),
]
def sha(b): return hashlib.sha256(b).hexdigest()
def write(path, data):
 path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f: f.write(data); tmp=Path(f.name)
 os.replace(tmp,path)
 assert sha(path.read_bytes())==sha(data)
def js(v): return json.dumps(v,ensure_ascii=False,separators=(',',':')).encode('utf-8')
def clean(text):
 lines=[]
 for line in unicodedata.normalize('NFC',text).splitlines():
  line=re.sub(r'[\t \u00a0\u2000-\u200b]+',' ',line).strip()
  if not line or re.fullmatch(r'[\d\s·ㆍ.－—–-]+',line): continue
  line=re.sub(r'[.·ㆍ]{5,}',' ',line)
  lines.append(line)
 return '\n'.join(lines).strip()
def split(text):
 pos=0
 while pos<len(text):
  end=min(pos+1250,len(text))
  if end<len(text):
   cut=text.rfind('\n',pos+700,end)
   if cut>pos: end=cut
  part=text[pos:end].strip()
  if part: yield part
  if end==len(text): break
  pos=max(pos+1,end-160)
def folio(doc,p):
 if doc=='local-ordinance-2026' and 9<=p<=570 and p not in {9,10,105,106,405,406,528,529,530}: return str(p-8)+"쪽"
 if doc=='legislation-2026' and 67<=p<=878 and p not in {67,68,113,114,794,795,796}: return str(p-66)+"쪽"
 if doc=='administrative-rules-2025' and 5<=p<=149 and p not in {5,20,21,35,57,115}: return str(p-4)+"쪽"
 if doc=='plain-language-2026':
  if 10<=p<=284 and p not in {17,126,127,213,241}: return str(p-8)+"쪽"
  if 291<=p<=391: return '부록 '+str(p-290)+'쪽'
 return None
def heading(text,doc,page):
 for l in text.splitlines()[:12]:
  if 3<=len(l)<=90 and re.match(r'(?:제\s*\d+\s*[편장절]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[. ]|\d+[.)]|[가-하][.)])',l): return l[:200]
 return f'{doc} · PDF {page}쪽' if page else doc
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);args=parser.parse_args()
 documents=[];chunks=[];coverage=[]
 for docid,prefix,title,edition,date,pages,expected,url,download,description in DEFS:
  candidates=[p for p in args.input.glob(prefix+'*') if p.suffix.lower() in {'.pdf','.hwpx','.txt'}];assert len(candidates)==1,(prefix,candidates)
  src=candidates[0];b=src.read_bytes();assert sha(b)==expected,(src,'original hash mismatch')
  fmt=src.suffix[1:].lower();name=docid+'.'+fmt;target=ROOT/'public'/'references'/name
  write(target,b)
  doc=dict(id=docid,title=title,edition=edition,coverageDate=date,pages=pages,sha256=expected,bytes=len(b),format=fmt,sourceUrl=url,officialDownloadUrl=download,downloadPath='/references/'+name,fileName=name,originalName=src.name,description=description,publisher='사용자 제공' if docid=='source-guide' else '법제처',collectedAt='2026-10-23',providedAt='2026-10-24',usage='원본을 변경하지 않고 제공합니다. 공식 게시 페이지의 출처 표시·이용 조건을 확인하세요. AI 작성 결과는 원본과 구분됩니다.',pageNote='PDF 쪽은 파일의 실제 페이지입니다. 인쇄 쪽은 확인된 본문만 표시하며, 부록은 별도 번호입니다.' if pages else '고정 PDF 쪽수가 없는 자료입니다.')
  if docid=='legislation-2026': doc['usage']='공식 게시 페이지에 공공누리 제4유형(출처 표시·상업적 이용 금지·변경 금지)이 표시되어 있습니다. 원본 파일은 변경하지 않고 제공하며 AI 작성 결과와 구분합니다.'
  if fmt=='pdf':
   assert len(PdfReader(src).pages)==pages
   raw=subprocess.check_output(['pdftotext','-layout','-enc','UTF-8',str(src),'-']).decode('utf-8')
   units=raw.split('\f');
   if not units[-1].strip(): units.pop()
   assert len(units)==pages,(docid,len(units),pages)
  elif fmt=='hwpx':
   with zipfile.ZipFile(src) as z:
    assert z.testzip() is None
    paragraphs=[]
    for fn in sorted(z.namelist()):
     if re.fullmatch(r'Contents/section\d+\.xml',fn):
      root=ET.fromstring(z.read(fn))
      for p in root.iter():
       if p.tag.endswith('}p'):
        # Nested table paragraphs are visited separately; collect only direct runs.
        txt=''.join(t.text or '' for run in p if run.tag.endswith('}run') for t in run if t.tag.endswith('}t'))
        if txt.strip(): paragraphs.append(txt)
    units=['\n'.join(paragraphs)]
  else: units=[b.decode('utf-8-sig')]
  start=len(chunks);readable=0;pageinfo=[]
  for i,raw in enumerate(units,1):
   text=clean(raw);page=i if pages else None
   if not text: pageinfo.append({'pdfPage':page,'characters':0,'chunks':0});continue
   readable+=1
   section=heading(text,title,page) if pages else ('의견제시 요청서 항목' if fmt=='hwpx' else '출처 및 파일 안내')
   st='body'
   if pages:
    first={'local-ordinance-2026':9,'legislation-2026':67,'administrative-rules-2025':5,'plain-language-2026':10}[docid]
    if i<first: st='contents' if re.search(r'목\s*차|CONTENTS',text,re.I) or len(re.findall(r'\.{3,}',raw))>2 else 'frontmatter'
   parts=list(split(text))
   for c,part in enumerate(parts,1):
    chunks.append(dict(id=f'KB-{docid}-p{i:04d}-c{c:02d}',documentId=docid,pdfPage=page,printedPage=folio(docid,i) if pages else None,section=section,sectionType=st,text=part,contentHash=sha(part.encode())))
   pageinfo.append({'pdfPage':page,'characters':len(text),'chunks':len(parts)})
  doc['chunkCount']=len(chunks)-start;doc['textPages']=readable if pages else None
  documents.append(doc);coverage.append({'documentId':docid,'pages':pageinfo,'textUnits':readable,'chunks':len(chunks)-start})
 corpus=js({'version':VERSION,'chunks':chunks});compressed=gzip.compress(corpus,compresslevel=9,mtime=0)
 write(ROOT/'data/knowledge/corpus.json.gz',compressed)
 manifest=dict(version=VERSION,generatedAt='2026-10-24T00:00:00.000Z',method='hybrid-lexical',chunkCount=len(chunks),totalPdfPages=sum(d['pages'] or 0 for d in documents),originalBytes=sum(d['bytes'] for d in documents),corpusSha256=sha(compressed),documents=documents)
 write(ROOT/'src/data/knowledge/manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2).encode()+b'\n')
 index={c['id']:sha(js([c[k] for k in ['id','documentId','pdfPage','printedPage','section','sectionType','text']])) for c in chunks}
 write(ROOT/'src/data/knowledge/citation-index.json',js(index)+b'\n')
 write(ROOT/'data/knowledge/coverage.json',json.dumps({'version':VERSION,'documents':coverage},ensure_ascii=False,indent=2).encode()+b'\n')
 print(json.dumps({'documents':len(documents),'pdfPages':manifest['totalPdfPages'],'chunks':len(chunks),'originalBytes':manifest['originalBytes'],'corpusBytes':len(compressed),'documentChunks':[(d['id'],d['chunkCount']) for d in documents]},ensure_ascii=False))
if __name__=='__main__': main()
