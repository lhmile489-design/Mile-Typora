# 恶意样本：HTML

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')">

<a href="javascript:alert('xss')">点击</a>

<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">数据链接</a>

<iframe src="https://example.com"></iframe>

<div style="background:url(javascript:alert(1))">内联样式</div>

<svg onload="alert('xss')"><circle r="10"/></svg>

普通段落里的 <b onclick="alert(1)">内联 HTML</b> 应当以文本显示。
