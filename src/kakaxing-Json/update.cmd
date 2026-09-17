@echo off
chcp 65001 >nul
title 咔咔猩数据快照 · 一键更新
cd /d "%~dp0"

echo ============================================
echo   咔咔猩数据快照更新（增量抓新 + 校验 + 重新渲染）
echo   用法: update.cmd         增量更新（快，日常用）
echo         update.cmd full    全量刷新（约 2-3 分钟）
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js
  pause & exit /b 1
)

if /i "%~1"=="full" (
  node scrape-kakaxing.mjs
) else (
  node scrape-kakaxing.mjs --inc
)
if errorlevel 1 (
  echo [错误] 抓取失败，详见上方日志
  pause & exit /b 1
)

node verify.mjs
if errorlevel 1 (
  echo [错误] 数据校验未通过（发现 ID 级重复或文件损坏），详见上方日志
  pause & exit /b 1
)

node build-viewer.mjs
if errorlevel 1 (
  echo [错误] 渲染失败，详见上方日志
  pause & exit /b 1
)

echo.
echo ✅ 更新完成：browse.html 已刷新，双击即可查看最新数据。
echo    官方工作日 10:00 批量上新，日常跑一次本脚本即可同步。
pause
