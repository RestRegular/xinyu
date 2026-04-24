# 项目初始化文档

## GitHub信息

- **仓库地址**：[XinYu](https://github.com/RestRegular/xinyu.git)
- **Token获取方式**：向用户获取用于推送代码的Token
- **克隆命令**：`git clone https://GITHUB_TOKEN@github.com/RestRegular/xinyu.git`
- **用户名**：RestRegular

## 初始化流程

1. 向用户获取用于推送代码的Token
2. 使用克隆命令克隆仓库
3. 将 Token 写入环境变量并测试[`push.sh`](./push.sh)能否正常推送代码到远程仓库
4. 阅读项目的[`READ_ME_BEFORE_DEV.md`](READ_ME_BEFORE_DEV.md)文件，并在之后严格按照开发规范进行开发
5. 每次开发都需要自更新开发规范