"""Build original Hangul seal designs; run manually with fonttools[woff] 4.60.1 and shapely 2.1.2.

These are reference-inspired Sendb designs, not the unidentified commercial fonts
in the supplied images. ASCII is from the already licensed Nanum Brush Script.
No build/install/runtime generation or external text processing is required.
"""
import argparse, copy, hashlib, io, json, math
from functools import lru_cache
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.basePen import BasePen
from fontTools.svgLib.path import parse_path
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

OUT=Path('public/esign/fonts')
INITIALS=list('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ')
VOWELS=list('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ')
FINALS=['']+list('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ')
PAIRS=dict(zip(['ㄲ','ㄸ','ㅃ','ㅆ','ㅉ','ㄳ','ㄵ','ㄶ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅄ'], [('ㄱ','ㄱ'),('ㄷ','ㄷ'),('ㅂ','ㅂ'),('ㅅ','ㅅ'),('ㅈ','ㅈ'),('ㄱ','ㅅ'),('ㄴ','ㅈ'),('ㄴ','ㅎ'),('ㄹ','ㄱ'),('ㄹ','ㅁ'),('ㄹ','ㅂ'),('ㄹ','ㅅ'),('ㄹ','ㅌ'),('ㄹ','ㅍ'),('ㄹ','ㅎ'),('ㅂ','ㅅ')]))
COMPOUNDS={'ㅘ':('ㅗ','ㅏ'),'ㅙ':('ㅗ','ㅐ'),'ㅚ':('ㅗ','ㅣ'),'ㅝ':('ㅜ','ㅓ'),'ㅞ':('ㅜ','ㅔ'),'ㅟ':('ㅜ','ㅣ'),'ㅢ':('ㅡ','ㅣ')}
PATHS={
 'ㄱ':'M6 9H76Q93 9 93 26V94', 'ㄴ':'M7 6V76Q7 92 23 92H94',
 'ㄷ':'M94 8H23Q7 8 7 24V77Q7 93 23 93H94',
 'ㄹ':'M6 8H78Q93 8 93 23V39Q93 47 82 47H18Q7 47 7 59V77Q7 92 22 92H94',
 'ㅁ':'M25 8H76Q93 8 93 25V76Q93 93 76 93H25Q8 93 8 76V25Q8 8 25 8Z',
 'ㅂ':'M8 7V78Q8 92 23 92H77Q92 92 92 78V7M8 48H92',
 'ㅅ':'M50 7V27Q50 72 7 93M50 27Q50 72 93 93',
 'ㅇ':'M50 8C18 8 8 22 8 50C8 80 18 93 50 93C81 93 93 80 93 50C93 22 81 8 50 8Z',
 'ㅈ':'M7 8H93M50 8V27Q50 72 7 93M50 27Q50 72 93 93',
 'ㅊ':'M33 6H67M7 27H93M50 27V42Q50 73 7 94M50 42Q50 73 93 94',
 'ㅋ':'M6 8H77Q93 8 93 24V94M6 48H93',
 'ㅌ':'M94 8H24Q8 8 8 24V77Q8 93 24 93H94M8 48H94',
 'ㅍ':'M6 8H94M6 93H94M25 8V93M75 8V93',
 'ㅎ':'M34 6H66M7 25H93M50 46C22 46 10 53 10 70C10 88 22 94 50 94C79 94 91 88 91 70C91 53 79 46 50 46Z',
 'ㅏ':'M24 6V94M24 49H94','ㅑ':'M24 6V94M24 26H94M24 72H94',
 'ㅓ':'M76 6V94M6 49H76','ㅕ':'M76 6V94M6 26H76M6 72H76',
 'ㅐ':'M12 6V94M12 49H66M88 6V94','ㅒ':'M12 6V94M12 26H66M12 72H66M88 6V94',
 'ㅔ':'M63 6V94M6 49H63M91 6V94','ㅖ':'M63 6V94M6 26H63M6 72H63M91 6V94',
 'ㅗ':'M6 80H94M50 6V80','ㅛ':'M6 80H94M27 6V80M73 6V80',
 'ㅜ':'M6 20H94M50 20V94','ㅠ':'M6 20H94M27 20V94M73 20V94',
 'ㅡ':'M6 50H94','ㅣ':'M50 6V94',
}

class Flatten(BasePen):
 def __init__(self): super().__init__(None); self.lines=[]; self.points=[]
 def _moveTo(self,p):
  if self.points:self.lines.append(self.points)
  self.points=[p]
 def _lineTo(self,p):self.points.append(p)
 def _curveToOne(self,p1,p2,p3):
  p0=self.points[-1]
  for k in range(1,17):
   t=k/16;s=1-t;self.points.append(tuple(s*s*s*p0[j]+3*s*s*t*p1[j]+3*s*t*t*p2[j]+t*t*t*p3[j] for j in (0,1)))
 def _qCurveToOne(self,p1,p2):
  p0=self.points[-1]
  for k in range(1,13):
   t=k/12;s=1-t;self.points.append(tuple(s*s*p0[j]+2*s*t*p1[j]+t*t*p2[j] for j in (0,1)))
 def _closePath(self):
  self.points.append(self.points[0]);self._endPath()
 def _endPath(self):
  if self.points:self.lines.append(self.points);self.points=[]

@lru_cache(None)
def geometry(letter, style):
 if letter in PAIRS:
  from shapely.affinity import scale,translate
  a,b=PAIRS[letter];return unary_union([scale(geometry(a,style),.46,1,origin=(0,0)),translate(scale(geometry(b,style),.46,1,origin=(0,0)),xoff=54)])
 parser=Flatten();parse_path(PATHS[letter],parser);parser._endPath()
 width={'Doan':24,'Jeonseo':14,'Gilsang':18}[style]
 lines=[]
 for points in parser.lines:
  if style=='Doan': points=[(x,y) for x,y in points]
  elif style=='Jeonseo': points=[(x+2.2*math.sin(y*math.pi/100),y) for x,y in points]
  else: points=[(x+6*math.sin(y*math.pi/50),y+2.5*math.sin(x*math.pi/50)) for x,y in points]
  lines.append(LineString(points).buffer(width/2,quad_segs=6,cap_style=1,join_style=1))
 return unary_union(lines)

def glyph_from_geometry(shape):
 pen=TTGlyphPen(None)
 shapes=[shape] if isinstance(shape,Polygon) else list(shape.geoms)
 for poly in shapes:
  for ring in [poly.exterior,*poly.interiors]:
   pts=list(ring.coords)[:-1]
   # SVG coordinates are flipped for OpenType, keeping hole direction opposite.
   pen.moveTo((round(pts[0][0]*10),round(1000-pts[0][1]*10)))
   for x,y in pts[1:]:pen.lineTo((round(x*10),round(1000-y*10)))
   pen.closePath()
 return pen.glyph()

def parts(code):
 initial=INITIALS[code//588];vowel=VOWELS[(code//28)%21];final=FINALS[code%28]
 if vowel in COMPOUNDS:
  h,v=COMPOUNDS[vowel];items=[(initial,.02,.02,.56,.43 if final else .59),(h,.02,.48 if final else .66,.56,.22 if final else .31),(v,.66,.02,.32,.68 if final else .96)]
 elif vowel in 'ㅗㅛㅜㅠㅡ':
  items=[(initial,.02,.02,.96,.43 if final else .59),(vowel,.02,.49 if final else .67,.96,.21 if final else .31)]
 else:items=[(initial,.02,.02,.56,.68 if final else .96),(vowel,.66,.02,.32,.68 if final else .96)]
 if final:items.append((final,.02,.78,.96,.20))
 return items

def main():
 cli=argparse.ArgumentParser();cli.add_argument('--cns-font',type=Path,required=True);cli.add_argument('--reuse-cns',action='store_true');args=cli.parse_args()
 brush=TTFont(OUT/'SendbBrush-Regular.woff2',recalcTimestamp=False);brush_set=brush.getGlyphSet();brush_cmap=brush.getBestCmap();upem=brush['head'].unitsPerEm
 license_base=(OUT/'nanumbrushscript-OFL.txt').read_text(encoding='utf-8')
 license_text='Copyright (c) 2026 Sendb contributors (original Hangul seal designs).\nASCII source: Nanum Brush Script; original notices follow.\n\n'+license_base
 (OUT/'SendbSealDesigns-OFL.txt').write_text(license_text,encoding='utf-8')
 manifest={'description':'Original Sendb Hangul seal designs inspired by supplied reference styles, not the same unidentified source fonts. ASCII from licensed Nanum Brush Script.','fonts':[]}
 for style in ['Doan','Jeonseo','Gilsang']:
  names={letter:f'part{idx}' for idx,letter in enumerate(sorted(set(PATHS)|set(PAIRS)))}
  glyphs={'.notdef':TTGlyphPen(None).glyph()};cmap={};metrics={'.notdef':(1000,0)}
  for letter,gname in names.items():glyphs[gname]=glyph_from_geometry(geometry(letter,style));metrics[gname]=(1000,0)
  for code in range(11172):
   gname=f'uni{code+0xac00:04X}';pen=TTGlyphPen(glyphs)
   for letter,x,y,w,h in parts(code):pen.addComponent(names[letter],(w,0,0,h,x*1000,(1-y-h)*1000))
   glyphs[gname]=pen.glyph();metrics[gname]=(1000,0);cmap[code+0xac00]=gname
  for cp in range(32,127):
   if cp not in brush_cmap:continue
   gname=f'uni{cp:04X}';pen=TTGlyphPen(None);brush_set[brush_cmap[cp]].draw(TransformPen(pen,(1000/upem,0,0,1000/upem,0,0)))
   glyphs[gname]=pen.glyph();metrics[gname]=(round(brush['hmtx'][brush_cmap[cp]][0]*1000/upem),0);cmap[cp]=gname
  builder=FontBuilder(1000,isTTF=True);builder.setupGlyphOrder(list(glyphs));builder.setupCharacterMap(cmap);builder.setupGlyf(glyphs);builder.setupHorizontalMetrics(metrics);builder.setupHorizontalHeader(ascent=1100,descent=-200)
  family=f'Sendb Seal {style}';ps=f'SendbSeal{style}-Regular'
  builder.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':f'Sendb:{ps}:2026','fullName':family+' Regular','psName':ps,'version':'Version 1.000','copyright':'Copyright 2026 Sendb contributors. ASCII: Nanum Brush Script, NHN Corporation. SIL OFL 1.1.'})
  builder.setupOS2(sTypoAscender=1100,sTypoDescender=-200,usWinAscent=1100,usWinDescent=200);builder.setupPost();builder.setupMaxp();builder.font['head'].created=builder.font['head'].modified=3875126400
  builder.font.flavor='woff2';file=ps+'.woff2';builder.font.save(OUT/file)
  data=(OUT/file).read_bytes();manifest['fonts'].append({'family':family,'file':file,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'hangulSyllables':11172,'ascii':95,'licenseFile':'SendbSealDesigns-OFL.txt'})
 source=args.cns_font.read_bytes();source_sha=hashlib.sha256(source).hexdigest()
 assert source_sha=='e8501dc9747190936a222576c9b0b6f918ff335afa5696c3fda3acba1a9574e2','Unexpected CNS source font'
 if args.reuse_cns:
  entry=json.loads((OUT/'reference-seal-sources.json').read_text(encoding='utf-8'))['fonts'][-1]
  assert entry['sourceSha256']==source_sha
  for chunk in entry['chunks']:assert hashlib.sha256((OUT/chunk['file']).read_bytes()).hexdigest()==chunk['sha256']
  manifest['fonts'].append(entry);(OUT/'reference-seal-sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('Hangul designs rebuilt; verified CNS chunks retained.');return
 cns=TTFont(io.BytesIO(source),recalcTimestamp=False);mapping=cns.getBestCmap()
 supported=''.join(chr(cp) for cp,glyph in sorted(mapping.items()) if cp>=0x3400 and cns['glyf'][glyph].numberOfContours!=0)
 chunks=[]
 for block in sorted({ord(char)//128*128 for char in supported}):
  chunk_glyphs={'.notdef':TTGlyphPen(None).glyph()};chunk_metrics={'.notdef':(1000,0)};chunk_cmap={}
  def include(gname):
   if gname in chunk_glyphs:return
   glyph=copy.deepcopy(cns['glyf'][gname]);glyph.removeHinting();chunk_glyphs[gname]=glyph;chunk_metrics[gname]=cns['hmtx'][gname]
   if glyph.isComposite():
    for component in glyph.components:include(component.glyphName)
  for char in supported:
   cp=ord(char)
   if block<=cp<block+128:include(mapping[cp]);chunk_cmap[cp]=mapping[cp]
  builder=FontBuilder(cns['head'].unitsPerEm,isTTF=True);builder.setupGlyphOrder(list(chunk_glyphs));builder.setupCharacterMap(chunk_cmap);builder.setupGlyf(chunk_glyphs);builder.setupHorizontalMetrics(chunk_metrics)
  builder.setupHorizontalHeader(ascent=cns['hhea'].ascent,descent=cns['hhea'].descent);builder.setupNameTable({'familyName':'Sendb Seal CNS','styleName':'Regular','uniqueFontIdentifier':f'Sendb:CNSSeal:{block:x}:2026','fullName':'Sendb Seal CNS Regular','psName':f'SendbSealCNS{block:x}-Regular','copyright':'Source: CNS11643 / CMEX; SIL OFL 1.1; subset and renamed.'})
  builder.setupOS2(sTypoAscender=cns['hhea'].ascent,sTypoDescender=cns['hhea'].descent,usWinAscent=cns['head'].yMax,usWinDescent=max(0,-cns['head'].yMin));builder.setupPost();builder.setupMaxp();builder.font['head'].created=builder.font['head'].modified=3875126400
  builder.font.flavor='woff2';file=f'SendbSealCNS-{block:x}.woff2';builder.font.save(OUT/file)
  data=(OUT/file).read_bytes();chunks.append({'block':block,'file':file,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 ofl=license_base[license_base.index('SIL OPEN FONT LICENSE'):]
 (OUT/'SendbSealCNS-OFL.txt').write_text('Source: Ministry of Digital Affairs, CNS11643 Chinese Standard Interchange Code website, https://www.cns11643.gov.tw\nSource font: 全字庫說文解字 TrueType, CMEX, Version 001.000.\nOfficial license declaration: https://www.cns11643.gov.tw/pageView.jsp?ID=59&SN=&la=0&lang=tw\nLicensed under the offered SIL Open Font License 1.1.\nModification: renamed family, subset to mapped ideographs, WOFF2 conversion.\n\n'+ofl,encoding='utf-8')
 manifest['fonts'].append({'family':'Sendb Seal CNS','source':'https://www.cns11643.gov.tw/downloadList.jsp?ID=2&ID2=20','sourceSha256':source_sha,'bytes':sum(c['bytes'] for c in chunks),'supportedIdeographs':len(supported),'chunks':chunks,'licenseFile':'SendbSealCNS-OFL.txt'})
 (OUT/'seal-hanja-coverage.json').write_text(json.dumps(supported,ensure_ascii=False)+'\n',encoding='utf-8')
 (OUT/'reference-seal-sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'files':len(chunks)+3,'fonts':[{k:v for k,v in item.items() if k!='chunks'} for item in manifest['fonts']]},ensure_ascii=False))

if __name__=='__main__':main()
