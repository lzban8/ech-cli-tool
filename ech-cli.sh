#!/bin/bash

# ECH Workers Client 一键管理脚本
# 支持系统: Debian / Ubuntu / Armbian / CentOS 7+ / OpenWrt (iStoreOS)
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
SERVICE_FILE_SYSTEMD="/etc/systemd/system/ech-workers.service"
SERVICE_FILE_OPENWRT="/etc/init.d/ech-workers"
CONF_FILE="/etc/ech-workers.conf"

# 全局变量：是否为 OpenWrt
IS_OPENWRT=0

# 检查是否为 Root 用户
[[ $EUID -ne 0 ]] && echo -e "${RED}错误: 必须使用 root 用户运行此脚本！${PLAIN}" && exit 1

# 检查系统类型
check_os() {
    if [ -f /etc/openwrt_release ]; then
        IS_OPENWRT=1
    elif [ -f /etc/os-release ] && grep -q "OpenWrt" /etc/os-release;
 then
        IS_OPENWRT=1
    else
        IS_OPENWRT=0
    fi
}

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
    check_os
    
    if [ "$IS_OPENWRT" -eq 1 ]; then
        echo -e "${GREEN}检测到 OpenWrt/iStoreOS 系统${PLAIN}"
        echo -e "${YELLOW}正在更新 opkg 软件源...${PLAIN}"
        opkg update
        echo -e "${YELLOW}正在安装依赖 (curl, wget, jq, tar, ca-bundle)...${PLAIN}"
        # 安装 wget-ssl 以支持 https，安装 ca-bundle / ca-certificates
        opkg install curl wget-ssl tar jq ca-bundle ca-certificates
        # 部分固件 wget 可能是 busybox 版本，确保有完整版或 curl 可用
    elif [ -f /etc/debian_version ]; then
        apt-get update -y
        apt-get install -y curl wget tar jq
    elif [ -f /etc/redhat-release ]; then
        yum install -y curl wget tar jq
    else
        echo -e "${RED}无法识别的系统，请手动安装 curl, wget, tar, jq${PLAIN}"
    fi
    
    # 确保 /usr/local/bin 存在
    mkdir -p /usr/local/bin
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

# 备份配置

# 多优选IP测速
test_best_ip() {
    echo -e "${YELLOW}正在测速优选IP...${PLAIN}"
    
    # 优选域名测试列表
    TEST_IPS=("ip.164746.xyz" "cdn.2020111.xyz" "bestcf.top" "cfip.cfcdn.vip" "speed.marisalnc.com" "freeyx.cloudflare88.eu.org" "cfip.xxxxxxxx.tk" "saas.sin.fan" "cf.090227.xyz" "cloudflare.182682.xyz" "bestcf.030101.xyz")
    
    BEST_TIME=9999000  # 使用毫秒整数，避免浮点运算
    BEST_IP_RESULT=""
    
    for ip in "${TEST_IPS[@]}"; do
        # 使用 curl 测量连接时间（毫秒）
        TIME_MS=$(curl -o /dev/null -s -w '%{time_total}' --connect-timeout 3 -m 5 "https://${ip}" 2>/dev/null | awk '{printf "%.0f", $1 * 1000}')
        if [ $? -eq 0 ] && [ ! -z "$TIME_MS" ] && [ "$TIME_MS" != "0" ]; then
            echo -e "  ${ip}: ${GREEN}${TIME_MS}ms${PLAIN}"
            # 纯整数比较，无需 bc
            if [ "$TIME_MS" -lt "$BEST_TIME" ] 2>/dev/null; then
                BEST_TIME=$TIME_MS
                BEST_IP_RESULT=$ip
            fi
        else
            echo -e "  ${ip}: ${RED}超时${PLAIN}"
        fi
    done
    
    if [ ! -z "$BEST_IP_RESULT" ]; then
        echo -e "${GREEN}最优IP: $BEST_IP_RESULT (${BEST_TIME}ms)${PLAIN}"
        read -p "是否使用此IP？[y/N]: " confirm
        if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
            BEST_IP="$BEST_IP_RESULT"
            save_config
            create_service
            read -p "是否立即重启服务生效？[y/N]: " restart_now
            if [[ "$restart_now" == "y" || "$restart_now" == "Y" ]]; then
                svc_restart
                echo -e "${GREEN}服务已重启！${PLAIN}"
            fi
        fi
    else
        echo -e "${RED}所有域名测速失败，请检查网络${PLAIN}"
    fi
}

# 状态检查
status_check() {
    echo -e "${YELLOW}执行状态检查...${PLAIN}"
    
    # 确保配置已加载
    load_config
    check_os
    
    # 检查进程
    if svc_is_active; then
        echo -e "  服务状态: ${GREEN}运行中${PLAIN}"
    else
        echo -e "  服务状态: ${RED}未运行${PLAIN}"
        read -p "服务未运行，是否启动？[y/N]: " confirm
        if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
            svc_start
        fi
        return
    fi
    
    # 检查端口 - 从 LISTEN_ADDR 提取端口号
    if [ -z "$LISTEN_ADDR" ]; then
        echo -e "  端口监听: ${RED}配置异常 (LISTEN_ADDR 未设置)${PLAIN}"
        return
    fi
    
    # 提取端口号
    CONF_PORT=$(echo "$LISTEN_ADDR" | grep -oE '[0-9]+$')
    if [ -z "$CONF_PORT" ]; then
        echo -e "  端口监听: ${RED}无法解析端口 (LISTEN_ADDR=$LISTEN_ADDR)${PLAIN}"
        return
    fi
    
    echo -e "  监听地址: ${CYAN}$LISTEN_ADDR${PLAIN}"
    
    # 检查端口是否监听
    PORT_OK=0
    if command -v ss >/dev/null 2>&1; then
        if ss -ln | grep -q ":${CONF_PORT} \|:${CONF_PORT}$"; then
            PORT_OK=1
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -ln | grep -q ":${CONF_PORT} \|:${CONF_PORT}$"; then
            PORT_OK=1
        fi
    else
        PORT_OK=2
    fi
    
    if [ "$PORT_OK" -eq 1 ]; then
        echo -e "  端口监听: ${GREEN}正常${PLAIN}"
    elif [ "$PORT_OK" -eq 0 ]; then
        echo -e "  端口监听: ${RED}异常 - 端口 $CONF_PORT 未监听${PLAIN}"
        return
    else
    fi
    
    # 测试代理连接 - 使用轻量级请求
    echo -e "  测试代理连接..."
    
    # 测试 1: 使用 curl 通过代理获取 IP 和归属地
    TEST_OK=0
    PROXY_IP=""
    IP_INFO=""
    
    # 尝试通过 ip.sb 获取 IP 和详细信息
    IP_RESULT=$(curl -x socks5h://127.0.0.1:$CONF_PORT -s -m 8 "https://api.ip.sb/geoip" 2>/dev/null)
    if [ ! -z "$IP_RESULT" ]; then
        PROXY_IP=$(echo "$IP_RESULT" | grep -oE '"ip":"[^"]+"' | cut -d'"' -f4)
        IP_COUNTRY=$(echo "$IP_RESULT" | grep -oE '"country":"[^"]+"' | cut -d'"' -f4)
        IP_CITY=$(echo "$IP_RESULT" | grep -oE '"city":"[^"]+"' | cut -d'"' -f4)
        IP_ISP=$(echo "$IP_RESULT" | grep -oE '"isp":"[^"]+"' | cut -d'"' -f4)
        IP_ORG=$(echo "$IP_RESULT" | grep -oE '"organization":"[^"]+"' | cut -d'"' -f4)
        
        if [ ! -z "$PROXY_IP" ]; then
            TEST_OK=1
            # 构建归属地信息
            if [ ! -z "$IP_COUNTRY" ]; then
                IP_INFO="$IP_COUNTRY"
                # 只有当城市与国家不同时才追加城市
                if [ ! -z "$IP_CITY" ] && [ "$IP_CITY" != "$IP_COUNTRY" ]; then
                    IP_INFO="$IP_INFO $IP_CITY"
                fi
            fi
            [ ! -z "$IP_ISP" ] && IP_INFO="$IP_INFO | $IP_ISP"
            [ -z "$IP_ISP" ] && [ ! -z "$IP_ORG" ] && IP_INFO="$IP_INFO | $IP_ORG"
        fi
    fi
    
    # 备用方案：httpbin
    if [ "$TEST_OK" -eq 0 ]; then
        PROXY_IP=$(curl -x socks5h://127.0.0.1:$CONF_PORT -s -m 8 "https://httpbin.org/ip" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        if [ ! -z "$PROXY_IP" ]; then
            TEST_OK=1
        fi
    fi
    
    if [ "$TEST_OK" -eq 1 ]; then
        echo -e "  优选出口: ${GREEN}$PROXY_IP${PLAIN}"
        if [ ! -z "$IP_INFO" ]; then
            echo -e "  IP 归属: ${CYAN}$IP_INFO${PLAIN}"
        fi
        
        # 额外测试 Cloudflare CDN 站点（通过 ProxyIP 访问）
        echo -e "  ${YELLOW}--- CF 反代测试 ---${PLAIN}"
        CF_RESULT=$(curl -x socks5h://127.0.0.1:$CONF_PORT -s -m 5 "https://cloudflare.com/cdn-cgi/trace" 2>/dev/null)
        if echo "$CF_RESULT" | grep -q "warp="; then
            CF_IP=$(echo "$CF_RESULT" | grep "ip=" | cut -d'=' -f2)
            CF_COLO=$(echo "$CF_RESULT" | grep "colo=" | cut -d'=' -f2)
            CF_LOC=$(echo "$CF_RESULT" | grep "loc=" | cut -d'=' -f2)
            
            if [ ! -z "$CF_IP" ]; then
                echo -e "  反代出口: ${GREEN}$CF_IP${PLAIN}"
            fi
            if [ ! -z "$CF_LOC" ] && [ ! -z "$CF_COLO" ]; then
                echo -e "  CF 节点: ${CYAN}$CF_LOC ($CF_COLO)${PLAIN}"
            elif [ ! -z "$CF_COLO" ]; then
                echo -e "  CF 节点: ${CYAN}$CF_COLO${PLAIN}"
            fi
        else
            echo -e "  反代状态: ${RED}失败${PLAIN}"
            echo -e "${YELLOW}可能原因: ProxyIP 配置错误或不可用${PLAIN}"
        fi
    else
        echo -e "  优选测试: ${RED}失败${PLAIN}"
        echo -e ""
        echo -e "${YELLOW}=== 故障排查 ===${PLAIN}"
        echo -e "  1. 检查服务端地址是否正确: ${CYAN}$SERVER_ADDR${PLAIN}"
        echo -e "  2. 检查 Token 是否与服务端一致"
        echo -e "  3. 检查网络连接是否正常"
        echo -e "  4. 查看日志: ${CYAN}journalctl -u ech-workers -n 50${PLAIN}"
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

# 生成 OpenWrt Procd 服务文件
create_service_openwrt() {
    cat > "$SERVICE_FILE_OPENWRT" <<EOF
#!/bin/sh /etc/rc.common

START=99
USE_PROCD=1

CONF_FILE="/etc/ech-workers.conf"

start_service() {
    if [ -f "\$CONF_FILE" ]; then
        . "\$CONF_FILE"
    else
        echo "Config file not found!"
        return 1
    fi

    procd_open_instance
    procd_set_param command $BIN_PATH
    procd_append_param command -f "\$SERVER_ADDR"
    procd_append_param command -l "\$LISTEN_ADDR"
    procd_append_param command -token "\$TOKEN"
    procd_append_param command -ip "\$BEST_IP"
    procd_append_param command -dns "\$DNS"
    procd_append_param command -ech "\$ECH_DOMAIN"
    procd_append_param command -routing "\$ROUTING"
    
    procd_set_param respawn
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_close_instance
}
EOF
    chmod +x "$SERVICE_FILE_OPENWRT"
    /etc/init.d/ech-workers enable >/dev/null 2>&1
}

# 生成 Systemd 服务文件
create_service_systemd() {
    cat > "$SERVICE_FILE_SYSTEMD" <<EOF
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

# 统一创建服务入口
create_service() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        create_service_openwrt
    else
        create_service_systemd
    fi
}

# 服务操作封装
svc_start() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        /etc/init.d/ech-workers start
    else
        systemctl start ech-workers
    fi
}

svc_stop() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        /etc/init.d/ech-workers stop
    else
        systemctl stop ech-workers
    fi
}

svc_restart() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        /etc/init.d/ech-workers restart
    else
        systemctl restart ech-workers
    fi
}

svc_disable() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        /etc/init.d/ech-workers disable
    else
        systemctl disable ech-workers
    fi
}

svc_is_active() {
    if [ "$IS_OPENWRT" -eq 1 ]; then
        # OpenWrt 检查进程是否存在
        if pgrep -f "$BIN_PATH" >/dev/null; then
            return 0
        else
            return 1
        fi
    else
        systemctl is-active --quiet ech-workers
    fi
}

# 安装/更新
install_ech() {
    install_dependencies
    check_arch
    
    echo -e "${YELLOW}正在获取最新版本信息...${PLAIN}"
    
    # 先检测网络环境
    IS_CN=0
    if ! curl -s -m 2 https://www.google.com >/dev/null; then
        IS_CN=1
        echo -e "${YELLOW}网络环境: 中国大陆 (或无法访问 Google)，使用镜像加速${PLAIN}"
    else
        echo -e "${GREEN}网络环境: 国际互联${PLAIN}"
    fi
    
    # 根据网络环境选择 API 地址
    if [ "$IS_CN" -eq 1 ]; then
        API_URL="https://gh-proxy.org/https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    else
        API_URL="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest"
    fi
    
    # 获取 Release JSON
    RELEASE_JSON=$(curl -s "$API_URL")
    
    # 尝试使用 jq 解析
    LATEST_URL=""
    if command -v jq >/dev/null 2>&1; then
        LATEST_URL=$(echo "$RELEASE_JSON" | jq -r ".assets[] | select(.name | contains(\"linux-${ARCH}\")) | .browser_download_url" 2>/dev/null | head -n 1)
    fi
    
    # 如果 jq 失败或未安装，使用 fallback 解析
    if [[ -z "$LATEST_URL" || "$LATEST_URL" == "null" ]]; then
        LATEST_URL=$(echo "$RELEASE_JSON" | grep "browser_download_url" | grep "linux-${ARCH}" | head -n 1 | cut -d '"' -f 4)
    fi
    
    # 如果 API 完全失败，使用硬编码的最新已知版本
    if [[ -z "$LATEST_URL" || "$LATEST_URL" == "null" ]]; then
        echo -e "${YELLOW}API 获取失败，使用备用下载链接...${PLAIN}"
        LATEST_URL="https://github.com/byJoey/ech-wk/releases/download/v1.4/ECHWorkers-linux-${ARCH}-softrouter.tar.gz"
    fi
    
    # 国内环境添加代理前缀
    if [ "$IS_CN" -eq 1 ]; then
        # 避免重复添加代理前缀
        if [[ "$LATEST_URL" != *"gh-proxy.org"* ]]; then
            LATEST_URL="https://gh-proxy.org/${LATEST_URL}"
        fi
    fi
    
    echo -e "${GREEN}下载链接: $LATEST_URL${PLAIN}"
    
    wget --no-check-certificate -O /tmp/ech-workers.tar.gz "$LATEST_URL"
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
            svc_restart
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
        svc_restart
        check_status
    fi
}

# 检查系统信息
get_sys_info() {
    if [ -f /etc/openwrt_release ]; then
        # 直接 source 文件读取变量，兼容性最好 (忽略错误输出)
        # 使用子 shell 避免污染当前环境
        OS=$(
            . /etc/openwrt_release >/dev/null 2>&1
            echo "$DISTRIB_DESCRIPTION" | awk '{print $1,$2}'
        )
        # 如果获取失败，回退到默认
        [ -z "$OS" ] && OS="OpenWrt"
    elif [ -f /etc/os-release ]; then
        OS=$(grep -oP 'PRETTY_NAME="\K[^"]+' /etc/os-release 2>/dev/null)
        # 如果 grep -P 不支持，尝试 source 方式
        if [ -z "$OS" ]; then
            OS=$(
                . /etc/os-release >/dev/null 2>&1
                echo "$PRETTY_NAME"
            )
        fi
    else
        OS=$(uname -s)
    fi
    ARCH=$(uname -m)
    KERNEL=$(uname -r)
}

# 检查状态
check_status() {
    get_sys_info
    if svc_is_active; then
        STATUS="${GREEN}运行中${PLAIN}"
        PID=$(pgrep -f $BIN_PATH | head -n 1)
        
        # 尝试获取格式化运行时长
        RUN_TIME=$(ps -o etime= -p $PID 2>/dev/null | tr -d ' ')
        
        # 如果 ps 不支持 etime (常见于 OpenWrt/Busybox)
        if [ -z "$RUN_TIME" ] && [ -f "/proc/$PID/stat" ]; then
            UPTIME_SEC=$(cat /proc/uptime | awk '{print int($1)}')
            # 第22位是启动时的 jiffies
            START_TICKS=$(cat /proc/$PID/stat | awk '{print $22}')
            # 获取系统每秒 ticks (通常为 100)
            CLK_TCK=$(getconf CLK_TCK 2>/dev/null || echo 100)
            START_SEC=$((START_TICKS / CLK_TCK))
            DIFF_SEC=$((UPTIME_SEC - START_SEC))
            
            if [ $DIFF_SEC -lt 0 ]; then DIFF_SEC=0; fi
            H=$((DIFF_SEC / 3600))
            M=$(( (DIFF_SEC % 3600) / 60 ))
            S=$((DIFF_SEC % 60))
            RUN_TIME=$(printf "%02d:%02d:%02d" $H $M $S)
        fi
        
        [ -z "$RUN_TIME" ] && RUN_TIME="Running"
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
        CLIENTS=$(ss -an state established | grep ":$CONF_PORT" | awk '{print $5}' | sed 's/\\[//g; s/\\]//g' | rev | cut -d: -f2- | rev | sort | uniq | grep -v "127.0.0.1")
    elif command -v netstat >/dev/null 2>&1; then
        CLIENTS=$(netstat -an | grep ":$CONF_PORT" | grep ESTABLISHED | awk '{print $5}' | sed 's/\\[//g; s/\\]//g' | rev | cut -d: -f2- | rev | sort | uniq | grep -v "127.0.0.1")
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
                 clean_ip=$(echo "$ip" | sed 's/:[0-9]*$//')
                 LOCATION=$(curl -s -m 2 "http://ip-api.com/line/${clean_ip}?fields=country,regionName,city,isp&lang=zh-CN")
                 if [ ! -z "$LOCATION" ]; then
                     LOC_STR=$(echo "$LOCATION" | tr '\n' ' ' | sed 's/ $//')
                     echo -e " ${CYAN}$ip${PLAIN} 	-> ${YELLOW}[$LOC_STR]${PLAIN}"
                 else
                     echo -e " ${CYAN}$ip${PLAIN} 	-> ${RED}[位置查询超时]${PLAIN}"
                 fi
             fi
         done <<< "$CLIENTS"
    fi
    echo -e "------------------------------------------------------"

    echo -e "${YELLOW}正在获取最后 50 行日志 (按 Ctrl+C 退出)...${PLAIN}"
    if [ "$IS_OPENWRT" -eq 1 ]; then
        logread -e "ech-workers" | tail -n 50
        echo -e "${YELLOW}(OpenWrt 请使用 'logread -f -e ech-workers' 查看实时日志)${PLAIN}"
    else
        journalctl -u ech-workers -n 50 -f
    fi
}

# 脚本版本
SCRIPT_VER="v1.2.0"

# 版本号比较函数：判断 $1 是否大于 $2
# 返回 0 表示 $1 > $2，返回 1 表示 $1 <= $2
version_gt() {
    # 去掉 v 前缀
    local v1="${1#v}"
    local v2="${2#v}"
    
    # 纯 Shell 实现版本比较，兼容 BusyBox
    local IFS='.'
    set -- $v1
    local v1_major=${1:-0} v1_minor=${2:-0} v1_patch=${3:-0}
    set -- $v2
    local v2_major=${1:-0} v2_minor=${2:-0} v2_patch=${3:-0}
    
    # 逐位比较
    if [ "$v1_major" -gt "$v2_major" ] 2>/dev/null; then return 0; fi
    if [ "$v1_major" -lt "$v2_major" ] 2>/dev/null; then return 1; fi
    if [ "$v1_minor" -gt "$v2_minor" ] 2>/dev/null; then return 0; fi
    if [ "$v1_minor" -lt "$v2_minor" ] 2>/dev/null; then return 1; fi
    if [ "$v1_patch" -gt "$v2_patch" ] 2>/dev/null; then return 0; fi
    
    return 1
}

check_script_update() {
    # 如果已有缓存结果，直接使用
    if [ ! -z "$UPDATE_TIP" ]; then return; fi
    
    UPDATE_TMP="/tmp/ech_update_check"
    UPDATE_TMP_TIME="/tmp/ech_update_time"
    
    # 检查缓存是否过期（1小时 = 3600秒）
    CACHE_EXPIRED=1
    if [ -f "$UPDATE_TMP" ] && [ -f "$UPDATE_TMP_TIME" ]; then
        CACHE_TIME=$(cat "$UPDATE_TMP_TIME" 2>/dev/null || echo 0)
        NOW_TIME=$(date +%s)
        DIFF=$((NOW_TIME - CACHE_TIME))
        if [ "$DIFF" -lt 3600 ] 2>/dev/null; then
            CACHE_EXPIRED=0
        fi
    fi
    
    if [ "$CACHE_EXPIRED" -eq 1 ]; then
        # 同步获取版本（最多等待 3 秒）
        CHECK_URL="https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh"
        if ! curl -s -m 2 --head https://raw.githubusercontent.com >/dev/null 2>&1; then
            CHECK_URL="https://gh-proxy.org/https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh"
        fi
        
        REMOTE_VERSION=$(curl -s -m 3 "$CHECK_URL" 2>/dev/null | grep 'SCRIPT_VER="' | head -n 1 | cut -d '"' -f 2)
        if [ ! -z "$REMOTE_VERSION" ]; then
            echo "$REMOTE_VERSION" > "$UPDATE_TMP"
            date +%s > "$UPDATE_TMP_TIME"
        fi
    else
        REMOTE_VERSION=$(cat "$UPDATE_TMP" 2>/dev/null)
    fi
    
    # 判断版本
    if [ -z "$REMOTE_VERSION" ]; then
        UPDATE_TIP="${YELLOW}检查失败${PLAIN}"
        CAN_UPDATE=0
    elif version_gt "$REMOTE_VERSION" "$SCRIPT_VER"; then
        UPDATE_TIP="${GREEN}新版本: ${REMOTE_VERSION}${PLAIN}"
        CAN_UPDATE=1
    else
        UPDATE_TIP="${GREEN}最新${PLAIN}"
        CAN_UPDATE=0
    fi
}

# 更新脚本
update_script() {
    wget --no-check-certificate -O /root/ech-cli.sh "https://raw.githubusercontent.com/lzban8/ech-cli-tool/main/ech-cli.sh" && chmod +x /root/ech-cli.sh
    echo -e "${GREEN}脚本更新成功！请重新运行脚本。${PLAIN}"
    exit 0
}

# 卸载脚本和客户端
uninstall_all() {
    echo -e "${YELLOW}警告：此操作将彻底卸载 ECH 客户端服务，并删除脚本文件及所有配置！${PLAIN}"
    echo -e "${RED}所有数据将被清除且不可恢复。${PLAIN}"
    read -p "确定要继续吗？[y/N]: " confirm
    if [[ "$confirm" == "y" || "$confirm" == "Y" ]]; then
        # 1. 停止并禁用服务
        echo -e "${YELLOW}正在停止服务...${PLAIN}"
        svc_stop >/dev/null 2>&1
        svc_disable >/dev/null 2>&1
        
        # 2. 删除服务文件
        echo -e "${YELLOW}正在清理文件...${PLAIN}"
        rm -f "$SERVICE_FILE_SYSTEMD" "$SERVICE_FILE_OPENWRT"
        if [ "$IS_OPENWRT" -eq 0 ]; then
            systemctl daemon-reload >/dev/null 2>&1
        fi
        
        # 3. 删除二进制和配置
        rm -f "$BIN_PATH" "$CONF_FILE"
        
        # 4. 删除快捷指令
        rm -f /usr/bin/ech
        
        # 5. 删除脚本自身
        SCRIPT_PATH=$(readlink -f "$0")
        rm -f "$SCRIPT_PATH"
        
        echo -e "${GREEN}卸载完成！所有相关文件已清除。${PLAIN}"
        exit 0
    else
        echo -e "${GREEN}已取消${PLAIN}"
    fi
}

# 主菜单
show_menu() {
    clear
    check_os # 重新检测
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
    echo -e "当前版本: ${GREEN}${SCRIPT_VER}${PLAIN}  状态: ${UPDATE_TIP}"
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
    echo -e " ${GREEN}1.${PLAIN} 安装/更新客户端"
    echo -e " ${GREEN}2.${PLAIN} 更新脚本"
    echo -e " ${GREEN}3.${PLAIN} 修改配置"
    echo -e " ${GREEN}4.${PLAIN} 启动服务"
    echo -e " ${GREEN}5.${PLAIN} 停止服务"
    echo -e " ${GREEN}6.${PLAIN} 重启服务"
    echo -e " ${GREEN}7.${PLAIN} 查看日志"
    echo -e " ${GREEN}8.${PLAIN} 状态检查"
    echo -e " ${GREEN}9.${PLAIN} 优选IP测速"
    echo -e " ${GREEN}10.${PLAIN} 卸载客户端"
    echo -e " ${GREEN}11.${PLAIN} 创建快捷指令"
    echo -e " ${GREEN}12.${PLAIN} 彻底卸载"
    echo -e " ${GREEN}0.${PLAIN} 退出脚本"
    echo -e "------------------------------------------------------"
    read -p "请输入选择 [0-12]: " choice
    
    case $choice in
        1) install_ech ;;
        2) update_script ;;
        3) configure_ech ;;
        4) svc_start && echo -e "${GREEN}已启动${PLAIN}" ;;
        5) svc_stop && echo -e "${RED}已停止${PLAIN}" ;;
        6) svc_restart && echo -e "${GREEN}已重启${PLAIN}" ;;
        7) view_logs ;;
        8) status_check ;;
        9) test_best_ip ;;
        10) 
            svc_stop
            svc_disable
            rm -f $SERVICE_FILE_SYSTEMD $SERVICE_FILE_OPENWRT $BIN_PATH /usr/bin/ech
            if [ "$IS_OPENWRT" -eq 0 ]; then
                systemctl daemon-reload
            fi
            echo -e "${GREEN}已卸载${PLAIN}"
            ;;
        11) create_shortcut ;;
        12) uninstall_all ;;
        0) exit 0 ;;
        *) echo -e "${RED}无效选择${PLAIN}" ;;
    esac
    
    read -p "按回车键继续..."
}

# 命令行参数处理
if [ "$1" == "install" ]; then
    install_ech
    exit 0
fi

# 循环显示菜单
while true; do
    show_menu
done