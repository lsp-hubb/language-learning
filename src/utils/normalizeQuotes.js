// 弯引号 / HTML 实体 → 直引号
//
// 从 Word、PDF、网页复制来的英文常带弯引号（‘ ’ “ ”）以及对应的 HTML 实体，
// 与库里已有的直角引号混用会导致搜索、匹配、批注偏移等一系列问题，故统一归一。
//
// 三处都要调用，保证「库里库外一致」：
//   1. 输入侧：落库前清洗（编辑保存 / 录入保存）
//   2. 输出侧：展示、导出前清洗（兜底，库里已干净时幂等）
//   3. 已入库：加载后若发现仍含弯引号，清洗并静默回写，完成一次性迁移
export function normalizeQuotes(text) {
  return String(text == null ? '' : text)
    // 弯单引号 → 直角撇号 '
    .replace(/[‘’]|&lsquo;|&rsquo;|&#8216;|&#8217;/g, "'")
    // 弯双引号 → 直角双引号 "
    .replace(/[“”]|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
}

export default normalizeQuotes
