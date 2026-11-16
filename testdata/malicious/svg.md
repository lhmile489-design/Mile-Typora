# 用户 SVG

内联 SVG：

<svg xmlns="http://www.w3.org/2000/svg" onload="alert('xss')">
  <script>alert('xss')</script>
  <circle r="10" />
</svg>

作为图片引用：

![图标](icon.svg)
