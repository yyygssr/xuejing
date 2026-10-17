/* Office 文件样本生成器（自测专用，不进 APK）。
   为什么在 Node 侧造而不是找几个真文件放仓库里：
     · 没有 Word 也能造出**结构正确**的 docx/xlsx/pptx —— 它们就是 ZIP + XML；
     · 样本以 base64 注入页面，测试读的就是解析器真实要吃的字节，
       而不是「我以为解析器能吃的字符串」。
   ⚠️ 这里的 ZIP 写入器与 tools/fileprobe/probe.mjs 同源，只是给自测长期用。 */
import zlib from 'zlib';

function crc32(buf){
  let t = crc32.t;
  if(!t){
    t = crc32.t = new Uint32Array(256);
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for(let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
/* method: 8 = deflate-raw（Office 的真实做法）；0 = stored（顺带测「没压缩」分支） */
export function makeZip(entries, method = 8){
  const locals = [], centrals = [];
  let off = 0;
  for(const e of entries){
    const nameB = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = method === 0 ? raw : zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method === 0 ? 0 : 8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method === 0 ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(Buffer.concat([ch, nameB]));
    off += 30 + nameB.length + comp.length;
  }
  const body = Buffer.concat(locals), cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, end]);
}

const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

const DOC_XML = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>数据结构第 3 章</w:t></w:r></w:p>
<w:p><w:r><w:t>线性表</w:t></w:r><w:r><w:t>与</w:t></w:r><w:r><w:t>链表的比较</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">  课后习题 12、13、14  </w:t></w:r></w:p>
<w:p><w:r><w:t>&lt;标记&gt; 与 &amp; 符号</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>查找方式</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>复杂度</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>折半查找</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>O(log n)</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:drawing/><w:t>图 3-2 折半查找判定树</w:t></w:r></w:p>
</w:body></w:document>`;

const SST_XML = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
<si><t>姓名</t></si><si><t>学号</t></si><si><t>张三</t></si>
<si><t>李四</t></si><si><r><t>富</t></r><r><t>文本</t></r></si></sst>`;
const SHEET1 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>20250101</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>20250102</v></c></row>
<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="inlineStr"><is><t>内联</t></is></c></row>
<row r="5"></row>
</sheetData></worksheet>`;
const SHEET2 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>第二张表</t></is></c></row>
</sheetData></worksheet>`;
const WB_XML = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
<sheet name="平时成绩" sheetId="1" r:id="rId1"/><sheet name="考勤" sheetId="2" r:id="rId2"/></sheets></workbook>`;

const SLIDE1 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:p><a:r><a:t>操作系统概述</a:t></a:r></a:p>
<a:p><a:r><a:t>进程与</a:t></a:r><a:r><a:t>线程的区别</a:t></a:r></a:p>
<a:p><a:r><a:t>调度算法：先来先服务</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const SLIDE2 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>死锁的四个必要条件</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

/* 一份「长文档」：段落多到必须选段，且只有靠后的一段含关键词。
   长度要能撑起 6 段以上 —— 只有 3 段的话「选段」和「全带」看不出差别，测不出东西。 */
function longDocXml(){
  let ps = '';
  for(let i = 1; i <= 120; i++){
    ps += `<w:p><w:r><w:t>第 ${i} 节 常规内容填充 ${'字'.repeat(80)}${i === 97 ? ' 牛顿冷却定律' : ''}</w:t></w:r></w:p>`;
  }
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps}</w:body></w:document>`;
}

export function fileFixtures(){
  const zip = (entries, m) => makeZip(entries, m).toString('base64');
  const f = {
    docx: zip([{ name:'[Content_Types].xml', data:CT }, { name:'word/document.xml', data:DOC_XML }]),
    docxStored: zip([{ name:'word/document.xml', data:DOC_XML }], 0),
    xlsx: zip([{ name:'[Content_Types].xml', data:CT }, { name:'xl/workbook.xml', data:WB_XML },
      { name:'xl/sharedStrings.xml', data:SST_XML }, { name:'xl/worksheets/sheet1.xml', data:SHEET1 },
      { name:'xl/worksheets/sheet2.xml', data:SHEET2 }]),
    pptx: zip([{ name:'[Content_Types].xml', data:CT }, { name:'ppt/slides/slide1.xml', data:SLIDE1 },
      { name:'ppt/slides/slide2.xml', data:SLIDE2 }]),
    longDocx: zip([{ name:'word/document.xml', data:longDocXml() }]),
    /* 真·空包：有目录但一个条目都没有 → 必须报「空的」而不是崩 */
    emptyZip: zip([]),
    /* 只有图片、没有正文文字的 docx（扫描件常见） */
    imgOnlyDocx: zip([{ name:'word/document.xml', data:'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>' }]),
  };
  /* GBK 的「中文」两个字节：0xD6D0 0xCEC4 —— UTF-8 解它是非法序列，
     正好用来证明「UTF-8 严格失败 → 换 gb18030」这条链路。 */
  f.gbkBytes = [0xD6, 0xD0, 0xCE, 0xC4];
  f.utf8Bom = [0xEF, 0xBB, 0xBF].concat([...Buffer.from('带 BOM 的文本', 'utf8')]);
  return f;
}
