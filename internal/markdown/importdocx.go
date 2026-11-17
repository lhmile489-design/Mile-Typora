package markdown

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"path"
	"regexp"
	"strings"
)

// ImportDOCX converts the main document stream of a DOCX package to Markdown.
// It never reads macros, embedded objects, headers, footers or external parts.
func ImportDOCX(ctx context.Context, data []byte) (ImportedDoc, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ImportedDoc{}, fmt.Errorf("docx: %w", err)
	}
	if err := checkDocxZip(zr); err != nil {
		return ImportedDoc{}, err
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[path.Clean(strings.ReplaceAll(f.Name, "\\", "/"))] = f
	}
	document := files["word/document.xml"]
	if document == nil {
		return ImportedDoc{}, fmt.Errorf("docx: word/document.xml is missing")
	}
	styles, err := readDocxStyles(files["word/styles.xml"])
	if err != nil {
		return ImportedDoc{}, err
	}
	rels, err := readDocxRelations(files["word/_rels/document.xml.rels"])
	if err != nil {
		return ImportedDoc{}, err
	}
	numbering, err := readDocxNumbering(files["word/numbering.xml"])
	if err != nil {
		return ImportedDoc{}, err
	}
	body, err := readZipEntry(document, 32<<20)
	if err != nil {
		return ImportedDoc{}, err
	}
	p := &docxImporter{
		ctx:       ctx,
		styles:    styles,
		rels:      rels,
		numbering: numbering,
		seen:      map[string]bool{},
	}
	text, err := p.convert(body)
	if err != nil {
		return ImportedDoc{}, err
	}
	return ImportedDoc{Text: cleanupImported(text), Warnings: p.warnings}, nil
}

type docxImporter struct {
	ctx       context.Context
	styles    map[string]string
	rels      map[string]string
	numbering map[string]string
	warnings  []string
	seen      map[string]bool
}

func (p *docxImporter) warn(message string) {
	if p.seen[message] {
		return
	}
	p.seen[message] = true
	p.warnings = append(p.warnings, message)
}

func (p *docxImporter) check() error {
	if err := p.ctx.Err(); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	return nil
}

func (p *docxImporter) convert(body []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(body))
	var out strings.Builder
	for {
		if err := p.check(); err != nil {
			return "", err
		}
		token, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch localName(start.Name) {
		case "p":
			line, err := p.paragraph(dec)
			if err != nil {
				return "", err
			}
			if line != "" {
				if out.Len() > 0 {
					out.WriteString("\n")
				}
				out.WriteString(line)
			}
		case "tbl":
			table, err := p.table(dec)
			if err != nil {
				return "", err
			}
			if table != "" {
				if out.Len() > 0 {
					out.WriteString("\n\n")
				}
				out.WriteString(table)
			}
		case "sectPr", "hdr", "ftr", "footnote", "endnote":
			if err := skipXML(dec); err != nil {
				return "", err
			}
		}
	}
	return strings.TrimSpace(out.String()), nil
}

func (p *docxImporter) paragraph(dec *xml.Decoder) (string, error) {
	var inline strings.Builder
	var style, numID string
	level := 0
	for {
		if err := p.check(); err != nil {
			return "", err
		}
		token, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "p" {
				text := strings.TrimRight(inline.String(), " \t")
				if text == "" {
					return "", nil
				}
				if numID != "" {
					prefix := strings.Repeat("  ", level)
					marker := "- "
					format := p.numbering[numID]
					if format != "" && !strings.Contains(format, "bullet") && !strings.Contains(format, "none") {
						marker = "1. "
					}
					return prefix + marker + text, nil
				}
				if heading := headingLevel(p.styles[style], style); heading > 0 {
					return strings.Repeat("#", heading) + " " + text, nil
				}
				return text, nil
			}
		case xml.StartElement:
			switch localName(t.Name) {
			case "pPr":
				if err := p.paragraphProps(dec, &style, &numID, &level); err != nil {
					return "", err
				}
			case "r":
				if err := p.run(dec, &inline); err != nil {
					return "", err
				}
			case "hyperlink":
				if err := p.hyperlink(dec, t, &inline); err != nil {
					return "", err
				}
			case "drawing", "pict":
				p.warn("内嵌图片未导入，只保留文字占位")
				inline.WriteString("[图片未导入]")
				if err := skipXML(dec); err != nil {
					return "", err
				}
			}
		}
	}
}

func (p *docxImporter) paragraphProps(dec *xml.Decoder, style, numID *string, level *int) error {
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "pPr" {
				return nil
			}
		case xml.StartElement:
			switch localName(t.Name) {
			case "pStyle":
				*style = docxAttr(t, "val")
				if err := skipXML(dec); err != nil {
					return err
				}
			case "numPr":
				if err := p.numberingProps(dec, numID, level); err != nil {
					return err
				}
			default:
				if err := skipXML(dec); err != nil {
					return err
				}
			}
		}
	}
}

func (p *docxImporter) numberingProps(dec *xml.Decoder, numID *string, level *int) error {
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "numPr" {
				return nil
			}
		case xml.StartElement:
			switch localName(t.Name) {
			case "numId":
				*numID = docxAttr(t, "val")
				if err := skipXML(dec); err != nil {
					return err
				}
			case "ilvl":
				value := docxAttr(t, "val")
				if value != "" {
					*level = int(value[0] - '0')
				}
				if err := skipXML(dec); err != nil {
					return err
				}
			default:
				if err := skipXML(dec); err != nil {
					return err
				}
			}
		}
	}
}

func (p *docxImporter) run(dec *xml.Decoder, out *strings.Builder) error {
	var text strings.Builder
	bold, italic, strike := false, false, false
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "r" {
				value := text.String()
				if value == "" {
					return nil
				}
				if strike {
					value = "~~" + value + "~~"
				}
				if italic {
					value = "*" + value + "*"
				}
				if bold {
					value = "**" + value + "**"
				}
				out.WriteString(value)
				return nil
			}
		case xml.StartElement:
			switch localName(t.Name) {
			case "rPr":
				if err := p.runProps(dec, &bold, &italic, &strike); err != nil {
					return err
				}
			case "t":
				value, err := elementText(dec)
				if err != nil {
					return err
				}
				text.WriteString(value)
			case "tab":
				text.WriteString("\t")
				if err := skipXML(dec); err != nil {
					return err
				}
			case "br":
				text.WriteString("  \n")
				if err := skipXML(dec); err != nil {
					return err
				}
			case "drawing", "pict":
				p.warn("内嵌图片未导入，只保留文字占位")
				text.WriteString("[图片未导入]")
				if err := skipXML(dec); err != nil {
					return err
				}
			default:
				if err := skipXML(dec); err != nil {
					return err
				}
			}
		}
	}
}

func (p *docxImporter) runProps(dec *xml.Decoder, bold, italic, strike *bool) error {
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "rPr" {
				return nil
			}
		case xml.StartElement:
			switch localName(t.Name) {
			case "b":
				*bold = true
			case "i":
				*italic = true
			case "strike", "dstrike":
				*strike = true
			}
			if err := skipXML(dec); err != nil {
				return err
			}
		}
	}
}

func (p *docxImporter) hyperlink(dec *xml.Decoder, start xml.StartElement, out *strings.Builder) error {
	linkID := docxAttr(start, "id")
	var inner strings.Builder
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "hyperlink" {
				text := inner.String()
				url := p.rels[linkID]
				if text == "" {
					return nil
				}
				if url != "" && safeImportURL(url, true) {
					out.WriteString("[" + text + "](" + url + ")")
				} else {
					out.WriteString(text)
					if url != "" {
						p.warn("已移除不支持的链接协议")
					}
				}
				return nil
			}
		case xml.StartElement:
			if localName(t.Name) == "r" {
				if err := p.run(dec, &inner); err != nil {
					return err
				}
			} else {
				if err := skipXML(dec); err != nil {
					return err
				}
			}
		}
	}
}

func (p *docxImporter) table(dec *xml.Decoder) (string, error) {
	var rows [][]string
	for {
		token, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "tbl" {
				return renderImportedTable(rows), nil
			}
		case xml.StartElement:
			if localName(t.Name) == "tr" {
				row, err := p.tableRow(dec)
				if err != nil {
					return "", err
				}
				rows = append(rows, row)
			} else if err := skipXML(dec); err != nil {
				return "", err
			}
		}
	}
}

func (p *docxImporter) tableRow(dec *xml.Decoder) ([]string, error) {
	var cells []string
	for {
		token, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "tr" {
				return cells, nil
			}
		case xml.StartElement:
			if localName(t.Name) == "tc" {
				cell, err := p.tableCell(dec)
				if err != nil {
					return nil, err
				}
				cells = append(cells, strings.ReplaceAll(strings.ReplaceAll(cell, "|", "\\|"), "\n", " "))
			} else if err := skipXML(dec); err != nil {
				return nil, err
			}
		}
	}
}

func (p *docxImporter) tableCell(dec *xml.Decoder) (string, error) {
	var parts []string
	for {
		token, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.EndElement:
			if localName(t.Name) == "tc" {
				return strings.Join(parts, " "), nil
			}
		case xml.StartElement:
			if localName(t.Name) == "p" {
				line, err := p.paragraph(dec)
				if err != nil {
					return "", err
				}
				if line != "" {
					parts = append(parts, line)
				}
			} else if err := skipXML(dec); err != nil {
				return "", err
			}
		}
	}
}

func renderImportedTable(rows [][]string) string {
	if len(rows) == 0 {
		return ""
	}
	columns := 0
	for _, row := range rows {
		if len(row) > columns {
			columns = len(row)
		}
	}
	if columns == 0 {
		return ""
	}
	for i := range rows {
		for len(rows[i]) < columns {
			rows[i] = append(rows[i], "")
		}
	}
	var b strings.Builder
	b.WriteString("| " + strings.Join(rows[0], " | ") + " |\n")
	sep := make([]string, columns)
	for i := range sep {
		sep[i] = "---"
	}
	b.WriteString("| " + strings.Join(sep, " | ") + " |\n")
	for _, row := range rows[1:] {
		b.WriteString("| " + strings.Join(row, " | ") + " |\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func readDocxStyles(f *zip.File) (map[string]string, error) {
	styles := map[string]string{}
	if f == nil {
		return styles, nil
	}
	data, err := readZipEntry(f, 8<<20)
	if err != nil {
		return nil, err
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("docx: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok || localName(start.Name) != "style" {
			continue
		}
		id := docxAttr(start, "styleId")
		name := ""
		for {
			inner, err := dec.Token()
			if err != nil {
				return nil, fmt.Errorf("docx: %w", err)
			}
			if end, ok := inner.(xml.EndElement); ok && localName(end.Name) == "style" {
				break
			}
			if start, ok := inner.(xml.StartElement); ok && localName(start.Name) == "name" {
				name = docxAttr(start, "val")
				if err := skipXML(dec); err != nil {
					return nil, err
				}
			}
		}
		if id != "" {
			styles[id] = name
		}
	}
	return styles, nil
}

func readDocxRelations(f *zip.File) (map[string]string, error) {
	rels := map[string]string{}
	if f == nil {
		return rels, nil
	}
	data, err := readZipEntry(f, 4<<20)
	if err != nil {
		return nil, err
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("docx: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if ok && localName(start.Name) == "Relationship" {
			id := docxAttr(start, "Id")
			target := docxAttr(start, "Target")
			if id != "" && target != "" {
				rels[id] = target
			}
			if err := skipXML(dec); err != nil {
				return nil, err
			}
		}
	}
	return rels, nil
}

func readDocxNumbering(f *zip.File) (map[string]string, error) {
	formats := map[string]string{}
	if f == nil {
		return formats, nil
	}
	data, err := readZipEntry(f, 8<<20)
	if err != nil {
		return nil, err
	}
	// abstractNumId -> first-level numFmt, then numId -> abstractNumId.
	abstract := map[string]string{}
	currentAbstract := ""
	dec := xml.NewDecoder(bytes.NewReader(data))
	for {
		token, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.StartElement:
			switch localName(t.Name) {
			case "abstractNum":
				currentAbstract = docxAttr(t, "abstractNumId")
			case "numFmt":
				if currentAbstract != "" {
					if _, exists := abstract[currentAbstract]; !exists {
						abstract[currentAbstract] = docxAttr(t, "val")
					}
					if err := skipXML(dec); err != nil {
						return nil, err
					}
				}
			case "num":
				numID := docxAttr(t, "numId")
				for {
					inner, err := dec.Token()
					if err != nil {
						return nil, fmt.Errorf("docx: %w", err)
					}
					if end, ok := inner.(xml.EndElement); ok && localName(end.Name) == "num" {
						break
					}
					if start, ok := inner.(xml.StartElement); ok && localName(start.Name) == "abstractNumId" {
						formats[numID] = abstract[docxAttr(start, "val")]
						if err := skipXML(dec); err != nil {
							return nil, err
						}
					}
				}
			}
		}
	}
	return formats, nil
}

var headingPattern = regexp.MustCompile(`(?i)(?:heading|标题)[ _-]?([1-6])`)

func headingLevel(name, id string) int {
	for _, value := range []string{name, id} {
		if match := headingPattern.FindStringSubmatch(value); match != nil {
			return int(match[1][0] - '0')
		}
		if strings.EqualFold(strings.TrimSpace(value), "title") {
			return 1
		}
	}
	return 0
}

func checkDocxZip(zr *zip.Reader) error {
	if len(zr.File) > 2048 {
		return fmt.Errorf("docx: too many entries")
	}
	var total uint64
	for _, f := range zr.File {
		name := path.Clean(strings.ReplaceAll(f.Name, "\\", "/"))
		if strings.HasPrefix(name, "../") || path.IsAbs(name) {
			return fmt.Errorf("docx: unsafe entry path")
		}
		size := f.UncompressedSize64
		if name == "word/document.xml" || name == "word/styles.xml" || name == "word/numbering.xml" || name == "word/_rels/document.xml.rels" {
			total += size
		}
		if total > 32<<20 {
			return fmt.Errorf("docx: unpacked content is too large")
		}
		if f.CompressedSize64 > 0 && size > 1<<20 && size/f.CompressedSize64 > 100 {
			return fmt.Errorf("docx: suspicious compression ratio")
		}
	}
	return nil
}

func readZipEntry(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("docx: %w", err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, limit+1))
	if err != nil {
		return nil, fmt.Errorf("docx: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("docx: an entry is too large")
	}
	return data, nil
}

func skipXML(dec *xml.Decoder) error {
	depth := 1
	for {
		token, err := dec.Token()
		if err != nil {
			return fmt.Errorf("docx: %w", err)
		}
		switch token.(type) {
		case xml.StartElement:
			depth++
		case xml.EndElement:
			depth--
			if depth == 0 {
				return nil
			}
		}
	}
}

func elementText(dec *xml.Decoder) (string, error) {
	var b strings.Builder
	for {
		token, err := dec.Token()
		if err != nil {
			return "", fmt.Errorf("docx: %w", err)
		}
		switch t := token.(type) {
		case xml.CharData:
			b.Write(t)
		case xml.EndElement:
			return b.String(), nil
		case xml.StartElement:
			if err := skipXML(dec); err != nil {
				return "", err
			}
		}
	}
}

func docxAttr(start xml.StartElement, name string) string {
	for _, attr := range start.Attr {
		if localName(attr.Name) == name {
			return attr.Value
		}
	}
	return ""
}

func localName(name xml.Name) string {
	return name.Local
}
