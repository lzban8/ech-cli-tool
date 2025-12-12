#!/bin/bash

# ECH Workers Client 一键管理脚本
# 支持系统: Debian / Ubuntu / Armbian / CentOS 7+ (需支持 systemd)
# 功能: 自动安装、配置、服务管理、日志查看

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
PLAIN='\033[0m'

# 变量定义
REPO_OWNER="byJoey"
REPO_NAME="ech-wk"
BIN_PATH="/usr/local/bin/ech-workers"
SERVICE_FILE="/etc/systemd/system/ech-workers.service"
CONF_FILE="/etc/ech-workers.conf"

# 检查是否为 Root 用户
[[ $EUID -ne 0 ]] && echo -e "${RED}错误: 必须使用 root 用户运行此脚本！${PLAIN}" && exit 1

# 检查系统架构
check_arch() {
    ARCH=$(uname -m)
    case $ARCH in
        x86_64)
            ARCH="amd64"
            ;;
        aarch64|armv8)
            ARCH="arm64"
            ;;
        *)
            echo -e "${RED}不支持的架构: $ARCH${PLAIN}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}检测到系统架构: linux-${ARCH}${PLAIN}"
}

# 安装依赖
install_dependencies() {
    echo -e "${YELLOW}正在检查并安装依赖...${PLAIN}"
    if [ -f /etc/debian_version ]; then
        apt-get update -y
        apt-get install -y curl wget tar jq
    elif [ -f /etc/redhat-release ]; then
        yum install -y curl wget tar jq
    else
        echo -e "${RED}无法识别的系统，请手动安装 curl, wget, tar, jq${PLAIN}"
    fi
}

# 获取配置
load_config() {
    if [ -f "$CONF_FILE" ]; then
        source "$CONF_FILE"
    else
        # 默认配置
        SERVER_ADDR="ech.example.com:443"
        LISTEN_ADDR="0.0.0.0:30000"
        TOKEN=""
        BEST_IP="www.visa.com.sg"
        DNS="dns.alidns.com/dns-query"
        ECH_DOMAIN="cloudflare-ech.com"
        ROUTING="bypass_cn"
    fi
}

# 保存配置
save_config() {
    cat > "$CONF_FILE" <<EOF
SERVER_ADDR="$SERVER_ADDR"
LISTEN_ADDR="$LISTEN_ADDR"
TOKEN="$TOKEN"
BEST_IP="$BEST_IP"
DNS="$DNS"
ECH_DOMAIN="$ECH_DOMAIN"
ROUTING="$ROUTING"
EOF
}

# 生成 Systemd 服务文件
create_service() {
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=ECH Workers Client Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/usr/local/bin
ExecStart=/usr/local/bin/ech-workers -f ${SERVER_ADDR} -l ${LISTEN_ADDR} -token ${TOKEN} -ip ${BEST_IP} -dns ${DNS} -ech ${ECH_DOMAIN} -routing ${ROUTING}
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable ech-workers >/dev/null 2>&1
}

# 安装/更新
install_ech() {
    install_dependencies
    check_arch
    
    echo -e "${YELLOW}正在获取最新版本信息...${PLAIN}"
    
    # 获取 Release JSON
    RELEASE_JSON=$(curl -s "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest")
    
    # 尝试使用 jq 解析
    LATEST_URL=""
    if command -v jq >/dev/null 2>&1; then
        LATEST_URL=$(echo "$RELEASE_JSON" | jq -r ".assets[] | select(.name | contains(\"linux-${ARCH}\")) | .browser_download_url")
    fi
    
    # 如果 jq 失败或未安装，使用 fallback 解析
    if [[ -z "$LATEST_URL" || "$LATEST_URL" == "null" ]]; then
        LATEST_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url" | grep "linux-${ARCH}" | head -n 1 | cut -d '"' -f 4)
    fi
    
    if [[ -z "$LATEST_URL" || "$LATEST_URL" == "null" ]]; then
        echo -e "${RED}获取下载链接失败，请检查网络或 GitHub API 限制${PLAIN}"
        return
    fi

    # 检测是否在中国
    if curl -s -m 2 https://www.google.com >/dev/null; then
        echo -e "${GREEN}网络环境: 国际互联${PLAIN}"
    else
        echo -e "${YELLOW}网络环境: 中国大陆 (或无法访问 Google)，使用镜像加速${PLAIN}"
        LATEST_URL="https://gh-proxy.org/${LATEST_URL}"
    fi
    
    echo -e "${GREEN}下载链接: $LATEST_URL${PLAIN}"
    
    wget -O /tmp/ech-workers.tar.gz "$LATEST_URL"
    if [ $? -ne 0 ]; then
        echo -e "${RED}下载失败！${PLAIN}"
        return
    fi
    
    # 解压
    mkdir -p /tmp/ech_install
    tar -zxvf /tmp/ech-workers.tar.gz -C /tmp/ech_install
    
    # 安装
    # 假设解压后文件在根目录或 bin 目录，这里暴力查找一下
    FIND_BIN=$(find /tmp/ech_install -type f -name "ech-workers" | head -n 1)
    if [ -f "$FIND_BIN" ]; then
        mv "$FIND_BIN" "$BIN_PATH"
        chmod +x "$BIN_PATH"
        echo -e "${GREEN}安装成功！${PLAIN}"
        rm -rf /tmp/ech-workers.tar.gz /tmp/ech_install
        
        # 如果是首次安装，提示配置
        if [ ! -f "$CONF_FILE" ]; then
            echo -e "${YELLOW}检测到首次安装，开始初始化配置...${PLAIN}"
            configure_ech
        else
            load_config
            create_service
            echo -e "${GREEN}服务已更新，正在重启...${PLAIN}"
            systemctl restart ech-workers
        fi

        # 创建快捷指令
        create_shortcut
    else
        echo -e "${RED}解压后未找到二进制文件，安装失败${PLAIN}"
    fi
}

# 创建快捷指令
create_shortcut() {
    cat > /usr/bin/ech <<EOF
#!/bin/bash
bash /root/ech-cli.sh
EOF
    chmod +x /usr/bin/ech
    echo -e "${GREEN}快捷指令 'ech' 已创建，以后输入 ech 即可启动此脚本！${PLAIN}"
}

# 配置菜单
configure_ech() {
    load_config
    echo -e "========================="
    echo -e "      配置向导"
    echo -e "========================="
    
    read -p "请输入 服务端地址 (当前: $SERVER_ADDR): " input
    [ ! -z "$input" ] && SERVER_ADDR="$input"
    
    read -p "请输入 本地监听地址 (当前: $LISTEN_ADDR): " input
    [ ! -z "$input" ] && LISTEN_ADDR="$input"
    
    read -p "请输入 Token (当前: $TOKEN): " input
    [ ! -z "$input" ] && TOKEN="$input"
    
    read -p "请输入 优选域名/IP (当前: $BEST_IP): " input
    [ ! -z "$input" ] && BEST_IP="$input"

    read -p "请输入 DOH服务器 (当前: $DNS): " input
    [ ! -z "$input" ] && DNS="$input"
    
    read -p "请输入 分流模式 (global/bypass_cn/none) (当前: $ROUTING): " input
    [ ! -z "$input" ] && ROUTING="$input"
    
    save_config
    create_service
    echo -e "${GREEN}配置已保存并应用！${PLAIN}"
    
    read -p "是否立即重启服务生效？[y/N]: " restart_now
    if [[ "$restart_now" == "y" || "$restart_now" == "Y" ]]; then
        systemctl restart ech-workers
        check_status
    fi
}

# 检查系统信息
get_sys_info() {
    if [ -f /etc/os-release ]; then
        OS=$(grep -oP 'PRETTY_NAME="\K[^"]+' /etc/os-release)
    else
        OS=$(uname -s)
    fi
    ARCH=$(uname -m)
    KERNEL=$(uname -r)
}

# 检查状态
check_status() {
    get_sys_info
    if systemctl is-active --quiet ech-workers; then
        STATUS="${GREEN}运行中${PLAIN}"
        PID=$(pgrep -f $BIN_PATH)
        RUN_TIME=$(ps -o etime= -p $PID | tr -d ' ')
    else
        STATUS="${RED}未运行${PLAIN}"
        PID="N/A"
        RUN_TIME="N/A"
    fi
}

# 获取日志
view_logs() {
    # 尝试提取端口
    CONF_PORT=${LISTEN_ADDR##*:}
    
    echo -e "------------------------------------------------------"
    echo -e "${YELLOW}>>> 当前活跃连接统计${PLAIN}"
    
    CLIENTS=""
    if command -v ss >/dev/null 2>&1; then
        # 修复 IPv6 显示不全问题 (移除最后冒号后的端口号，并清理中括号)
        CLIENTS=$(ss -an state established | grep ":$CONF_PORT" | awk '{print $5}' | sed 's/\[//g; s/\]//g' | rev | cut -d: -f2- | rev | sort | uniq | grep -v "127.0.0.1")
    elif command -v netstat >/dev/null 2>&1; then
        CLIENTS=$(netstat -an | grep ":$CONF_PORT" | grep ESTABLISHED | awk '{print $5}' | sed 's/\[//g; s/\]//g' | rev | cut -d: -f2- | rev | sort | uniq | grep -v "127.0.0.1")
    fi
    
    # 统计数量
    COUNT=$(echo "$CLIENTS" | sed '/^$/d' | wc -l)
    
    if [ "$COUNT" -eq "0" ] || [ -z "$CLIENTS" ]; then
         echo -e "当前无活跃客户端连接"
    else
         echo -e "在线客户端数: ${GREEN}$COUNT${PLAIN}"
         echo -e "客户端列表:"
         
         # 循环查询 IP 归属地
         while read -r ip; do
             if [ ! -z "$ip" ]; then
                 # 移除可能的端口号（兼容 ipv4:port 格式）
                 clean_ip=$(echo "$ip" | sed 's/:[0-9]*$//')
                 
                 # 使用 ip-api.com (HTTP) 查询，纯文本格式，增加超时
                 # 替换为更稳定的 API 或者增加重试。ip-api 很稳定，可能是 curl 参数问题。
                 # 尝试使用 -L 跟随重定向，-k 忽略证书（如果是https）
                 LOCATION=$(curl -s -m 2 "http://ip-api.com/line/${clean_ip}?fields=country,regionName,city,isp&lang=zh-CN")
                 
                 if [ ! -z "$LOCATION" ]; then
                     LOC_STR=$(echo "$LOCATION" | tr '\n' ' ' | sed 's/ $//')
                     echo -e " ${CYAN}$ip${PLAIN} \t-> ${YELLOW}[$LOC_STR]${PLAIN}"
                 else
                     echo -e " ${CYAN}$ip${PLAIN} \t-> ${RED}[位置查询超时]${PLAIN}"
                 fi
             fi
         done <<< "$CLIENTS"
    fi
    echo -e "------------------------------------------------------"

    echo -e "${YELLOW}正在获取最后 50 行日志 (按 Ctrl+C 退出)...${PLAIN}"
    journalctl -u ech-workers -n 50 -f
}

# 脚本版本
SCRIPT_VER="v1.1.1"

# 检查脚本更新
check_script_update() {
    # 避免重复检查
    if [ ! -z "$UPDATE_TIP" ]; then return; fi
    
    # 后台异步检查 (通过临时文件通讯)
    UPDATE_TMP="/tmp/ech_update_check"
    
    if [ ! -f "$UPDATE_TMP" ]; then
        # 如果没有临时文件，启动后台进程去查
        # 智能选择源：如果之前检测到在国内，就用加速镜像
        (
            CHECK_URL="https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh"
            # 简单检测一下 connectivity
            if ! curl -s -m 2 --head https://raw.githubusercontent.com >/dev/null; then
                 CHECK_URL="https://gh-proxy.org/https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh"
            fi
            
            REMOTE_VERSION=$(curl -s -m 5 "$CHECK_URL" | grep 'SCRIPT_VER="' | head -n 1 | cut -d '"' -f 2)
            echo "$REMOTE_VERSION" > "$UPDATE_TMP"
        ) &
        UPDATE_TIP="${YELLOW}检查中...${PLAIN}"
    else
        # 读取后台结果
        REMOTE_VERSION=$(cat "$UPDATE_TMP")
        if [[ -z "$REMOTE_VERSION" ]]; then
            # 可能是上次失败了，清理重试
             rm -f "$UPDATE_TMP"
             UPDATE_TIP="${YELLOW}检查中...${PLAIN}"
        elif [[ "$REMOTE_VERSION" != "$SCRIPT_VER" ]]; then
            UPDATE_TIP="${GREEN}新版本: ${REMOTE_VERSION}${PLAIN}"
            CAN_UPDATE=1
        else
            UPDATE_TIP="${GREEN}最新${PLAIN}"
            CAN_UPDATE=0
        fi
    fi
}

# 更新脚本
update_script() {
    wget -O /root/ech-cli.sh "https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh" && chmod +x /root/ech-cli.sh
    echo -e "${GREEN}脚本更新成功！请重新运行脚本。${PLAIN}"
    exit 0
}

# 主菜单
show_menu() {
    clear
    check_status
    load_config
    check_script_update

    echo -e "${BLUE}
    ███████╗ ██████╗██╗  ██╗
    ██╔════╝██╔════╝██║  ██║
    █████╗  ██║     ███████║
    ██╔══╝  ██║     ██╔══██║
    ███████╗╚██████╗██║  ██║
    ╚══════╝ ╚═════╝╚═╝  ╚═╝
    ${PLAIN}"
    echo -e "快捷键已设置为 ${YELLOW}ech${PLAIN} , 下次运行输入 ${YELLOW}ech${PLAIN} 即可"
    echo -e "当前版本: ${GREEN}${SCRIPT_VER}${PLAIN}  更新状态: ${UPDATE_TIP}"
    echo -e "------------------------------------------------------"
    echo -e "状态     : $STATUS"
    echo -e "系统     : $OS ($ARCH)"
    echo -e "内核     : $KERNEL"
    echo -e "运行时长 : $RUN_TIME"
    echo -e "------------------------------------------------------"
    echo -e "服务端地址   : ${BLUE}$SERVER_ADDR${PLAIN}"
    echo -e "本地监听地址 : ${BLUE}$LISTEN_ADDR${PLAIN}"
    echo -e "优选域名/IP  : ${CYAN}$BEST_IP${PLAIN}"
    echo -e "DOH服务器    : ${CYAN}$DNS${PLAIN}"
    echo -e "ECH 域名     : ${CYAN}$ECH_DOMAIN${PLAIN}"
    echo -e "Token        : ${PURPLE}$TOKEN${PLAIN}"
    echo -e "分流模式     : ${YELLOW}$ROUTING${PLAIN}"
    echo -e "------------------------------------------------------"
    echo -e " ${GREEN}1.${PLAIN} 安装 / 更新客户端"
    echo -e " ${GREEN}2.${PLAIN} 修改配置"
    echo -e " ${GREEN}3.${PLAIN} 启动服务"
    echo -e " ${GREEN}4.${PLAIN} 停止服务"
    echo -e " ${GREEN}5.${PLAIN} 重启服务"
    echo -e " ${GREEN}6.${PLAIN} 查看日志"
    echo -e " ${GREEN}7.${PLAIN} 卸载客户端"
    echo -e " ${GREEN}8.${PLAIN} 创建快捷指令 (修复)"
    echo -e " ${GREEN}9.${PLAIN} 更新管理脚本"
    echo -e " ${GREEN}0.${PLAIN} 退出脚本"
    echo -e "------------------------------------------------------"
    read -p "请输入选择 [0-9]: " choice
    
    case $choice in
        1) install_ech ;;
        2) configure_ech ;;
        3) systemctl start ech-workers && echo -e "${GREEN}已启动${PLAIN}" ;;
        4) systemctl stop ech-workers && echo -e "${RED}已停止${PLAIN}" ;;
        5) systemctl restart ech-workers && echo -e "${GREEN}已重启${PLAIN}" ;;
        6) view_logs ;;
        7) 
            systemctl stop ech-workers
            systemctl disable ech-workers
            rm -f $SERVICE_FILE $BIN_PATH /usr/bin/ech
            systemctl daemon-reload
            echo -e "${GREEN}已卸载${PLAIN}"
            ;;
        8) create_shortcut ;;
        9) update_script ;;
        0) exit 0 ;;
        *) echo -e "${RED}无效选择${PLAIN}" ;;
    esac
    
    read -p "按回车键继续..."
}

# 支持非交互安装
if [ "$1" == "install" ]; then
    install_ech
    exit 0
fi

# 循环显示菜单
while true; do
    show_menu
done
