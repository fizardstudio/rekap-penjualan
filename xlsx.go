package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Spesifikasi lembar kerja yang dikirim dari browser. Logika rekap ada di browser,
// server hanya menulis file .xlsx dengan gaya (tebal, garis, format angka).
type xCell struct {
	V any    `json:"v"`
	F string `json:"f,omitempty"` // rumus tanpa "="
	S string `json:"s,omitempty"` // kunci gaya
}

type xSheet struct {
	Name   string    `json:"name"`
	Cols   []float64 `json:"cols"`
	Rows   [][]any   `json:"rows"` // tiap sel: null, string, angka, atau xCell
	Merges []string  `json:"merges"`
	Freeze int       `json:"freeze"` // jumlah baris dibekukan
}

type xBook struct {
	Filename string   `json:"filename"`
	Sheets   []xSheet `json:"sheets"`
}

// urutan gaya = indeks cellXfs di styles.xml
var xStyles = map[string]int{
	"": 0, "title": 1, "hdr": 2, "txt": 3, "num": 4, "tot": 5, "totl": 6, "bold": 7, "sub": 8, "dec": 9, "date": 10, "pct": 11,
}

const stylesXML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="4">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="13"/><name val="Arial"/></font>
<font><b/><sz val="10"/><name val="Arial"/></font>
<font><i/><sz val="9"/><color rgb="FF667085"/><name val="Arial"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF9AA4B2"/></left><right style="thin"><color rgb="FF9AA4B2"/></right><top style="thin"><color rgb="FF9AA4B2"/></top><bottom style="thin"><color rgb="FF9AA4B2"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

func colName(i int) string {
	s := ""
	for i++; i > 0; i = (i - 1) / 26 {
		s = string(rune('A'+(i-1)%26)) + s
	}
	return s
}

func xmlEsc(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		switch {
		case r == '<':
			b.WriteString("&lt;")
		case r == '>':
			b.WriteString("&gt;")
		case r == '&':
			b.WriteString("&amp;")
		case r == '"':
			b.WriteString("&quot;")
		case r == '\t' || r == '\n' || r == '\r' || r >= 0x20:
			b.WriteRune(r)
		}
	}
	return b.String()
}

var badSheet = regexp.MustCompile(`[\\/?*\[\]:]`)

var sumRe = regexp.MustCompile(`^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$`)
var refRe = regexp.MustCompile(`^([A-Z]+)(\d+)$`)

func colIndex(s string) int {
	n := 0
	for _, r := range s {
		n = n*26 + int(r-'A'+1)
	}
	return n - 1
}

// parseCells mengubah baris mentah menjadi xCell dan mengisi nilai SUM / penjumlahan sel
// sederhana pada sheet yang sama, supaya penampil yang tidak menghitung ulang tetap benar.
func parseCells(sh *xSheet) [][]*xCell {
	grid := make([][]*xCell, len(sh.Rows))
	for ri, row := range sh.Rows {
		grid[ri] = make([]*xCell, len(row))
		for ci, raw := range row {
			if raw == nil {
				continue
			}
			c := &xCell{}
			if m, ok := raw.(map[string]any); ok {
				bs, _ := json.Marshal(m)
				_ = json.Unmarshal(bs, c)
			} else {
				c.V = raw
			}
			grid[ri][ci] = c
		}
	}
	num := func(r, c int) float64 {
		if r < 0 || r >= len(grid) || c < 0 || c >= len(grid[r]) || grid[r][c] == nil {
			return 0
		}
		if v, ok := grid[r][c].V.(float64); ok {
			return v
		}
		return 0
	}
	for pass := 0; pass < 3; pass++ {
		for ri := range grid {
			for _, c := range grid[ri] {
				if c == nil || c.F == "" {
					continue
				}
				if m := sumRe.FindStringSubmatch(c.F); m != nil {
					var r1, r2 int
					fmt.Sscan(m[2], &r1)
					fmt.Sscan(m[4], &r2)
					c1, c2 := colIndex(m[1]), colIndex(m[3])
					t := 0.0
					for r := r1 - 1; r <= r2-1; r++ {
						for cc := c1; cc <= c2; cc++ {
							t += num(r, cc)
						}
					}
					c.V = t
					continue
				}
				// "G13+G28+G42" pada sheet yang sama
				parts := strings.Split(c.F, "+")
				t, ok := 0.0, true
				for _, p := range parts {
					m := refRe.FindStringSubmatch(p)
					if m == nil {
						ok = false
						break
					}
					var r int
					fmt.Sscan(m[2], &r)
					t += num(r-1, colIndex(m[1]))
				}
				if ok {
					c.V = t
				}
			}
		}
	}
	return grid
}

func sheetXML(sh xSheet) string {
	grid := parseCells(&sh)
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	if sh.Freeze > 0 {
		fmt.Fprintf(&b, `<sheetViews><sheetView workbookViewId="0"><pane ySplit="%d" topLeftCell="A%d" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`, sh.Freeze, sh.Freeze+1)
	}
	if len(sh.Cols) > 0 {
		b.WriteString("<cols>")
		for i, w := range sh.Cols {
			fmt.Fprintf(&b, `<col min="%d" max="%d" width="%.1f" customWidth="1"/>`, i+1, i+1, w)
		}
		b.WriteString("</cols>")
	}
	b.WriteString("<sheetData>")
	for ri, row := range grid {
		fmt.Fprintf(&b, `<row r="%d">`, ri+1)
		for ci, cp := range row {
			if cp == nil {
				continue
			}
			c := *cp
			ref := colName(ci) + fmt.Sprint(ri+1)
			st := xStyles[c.S]
			if c.F != "" {
				val := ""
				if n, ok := c.V.(float64); ok {
					val = fmt.Sprintf("<v>%s</v>", fmtNum(n))
				}
				fmt.Fprintf(&b, `<c r="%s" s="%d"><f>%s</f>%s</c>`, ref, st, xmlEsc(c.F), val)
				continue
			}
			switch v := c.V.(type) {
			case float64:
				fmt.Fprintf(&b, `<c r="%s" s="%d"><v>%s</v></c>`, ref, st, fmtNum(v))
			case bool:
				t := "0"
				if v {
					t = "1"
				}
				fmt.Fprintf(&b, `<c r="%s" s="%d" t="b"><v>%s</v></c>`, ref, st, t)
			case nil:
				fmt.Fprintf(&b, `<c r="%s" s="%d"/>`, ref, st)
			default:
				fmt.Fprintf(&b, `<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, st, xmlEsc(fmt.Sprint(v)))
			}
		}
		b.WriteString("</row>")
	}
	b.WriteString("</sheetData>")
	if len(sh.Merges) > 0 {
		fmt.Fprintf(&b, `<mergeCells count="%d">`, len(sh.Merges))
		for _, m := range sh.Merges {
			fmt.Fprintf(&b, `<mergeCell ref="%s"/>`, xmlEsc(m))
		}
		b.WriteString("</mergeCells>")
	}
	b.WriteString(`<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/>`)
	b.WriteString("</worksheet>")
	return b.String()
}

func fmtNum(n float64) string {
	if n == float64(int64(n)) {
		return fmt.Sprint(int64(n))
	}
	return fmt.Sprintf("%.4f", n)
}

func buildXLSX(book xBook) ([]byte, error) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	add := func(name, body string) error {
		f, err := z.Create(name)
		if err != nil {
			return err
		}
		_, err = f.Write([]byte(body))
		return err
	}
	var ct, wbSheets, wbRels strings.Builder
	used := map[string]bool{}
	for i, sh := range book.Sheets {
		name := badSheet.ReplaceAllString(sh.Name, " ")
		if r := []rune(name); len(r) > 31 {
			name = string(r[:31])
		}
		if name == "" {
			name = fmt.Sprintf("Sheet%d", i+1)
		}
		base := name
		for k := 2; used[strings.ToLower(name)]; k++ {
			suf := fmt.Sprintf(" (%d)", k)
			r := []rune(base)
			if len(r)+len(suf) > 31 {
				r = r[:31-len(suf)]
			}
			name = string(r) + suf
		}
		used[strings.ToLower(name)] = true
		fmt.Fprintf(&ct, `<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, i+1)
		fmt.Fprintf(&wbSheets, `<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlEsc(name), i+1, i+1)
		fmt.Fprintf(&wbRels, `<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, i+1, i+1)
		if err := add(fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1), sheetXML(sh)); err != nil {
			return nil, err
		}
	}
	n := len(book.Sheets)
	_ = add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`+ct.String()+`</Types>`)
	_ = add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
	_ = add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>`+wbSheets.String()+`</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`)
	_ = add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+wbRels.String()+fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, n+1)+`</Relationships>`)
	_ = add("xl/styles.xml", stylesXML)
	if err := z.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (a *App) exportXLSX(w http.ResponseWriter, r *http.Request, u *User) {
	var book xBook
	if err := readJSON(r, &book); err != nil || len(book.Sheets) == 0 {
		fail(w, 400, "Data ekspor tidak valid.")
		return
	}
	b, err := buildXLSX(book)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	fn := book.Filename
	if fn == "" {
		fn = "rekap.xlsx"
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="rekap.xlsx"; filename*=UTF-8''`+url.PathEscape(fn))
	_, _ = w.Write(b)
}
