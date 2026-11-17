# 恶意样本：P2 扩展语法

> [!NOTE]
> 注意框内的 <script>alert('alert')</script>
> <img src="x" onerror="alert('alert-image')">
> [危险链接](javascript:alert('alert-link'))

## <script>alert('toc')</script>

[TOC]

脚注引用[^1]，定义中夹带脚本与图片。

[^1]: 脚注 <script>alert('footnote')</script> 与 <img src="x" onerror="alert('footnote-image')">

<u onclick="alert('underline')">事件属性下划线</u> 与 <u>普通下划线</u>

注释 <!-- <script>alert('comment')</script> --> 与 <!--[if IE]><script>alert('conditional')</script><![endif]-->

[引用链接][evil]

[evil]: javascript:alert('reference')

[远程引用][remote]

[remote]: https://example.com/pixel.png
