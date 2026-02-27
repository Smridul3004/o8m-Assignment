# O8M Frontend Build Script for Production Deployment
# Usage: .\build-production.ps1 -AuthUrl "https://..." -UserUrl "https://..." etc.

param(
    [Parameter(Mandatory=$true)]
    [string]$AuthUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$UserUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$DiscoveryUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$ChatUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$CallUrl,
    
    [Parameter(Mandatory=$true)]
    [string]$BillingUrl
)

Write-Host "Building Flutter Web for Production..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  AUTH_URL:      $AuthUrl"
Write-Host "  USER_URL:      $UserUrl"
Write-Host "  DISCOVERY_URL: $DiscoveryUrl"
Write-Host "  CHAT_URL:      $ChatUrl"
Write-Host "  CALL_URL:      $CallUrl"
Write-Host "  BILLING_URL:   $BillingUrl"
Write-Host ""

Set-Location -Path "$PSScriptRoot\client"

# Clean previous build
Write-Host "Cleaning previous build..." -ForegroundColor Yellow
flutter clean

# Get dependencies
Write-Host "Getting dependencies..." -ForegroundColor Yellow
flutter pub get

# Build with production URLs
Write-Host "Building release..." -ForegroundColor Yellow
flutter build web --release `
    --dart-define="AUTH_URL=$AuthUrl" `
    --dart-define="USER_URL=$UserUrl" `
    --dart-define="DISCOVERY_URL=$DiscoveryUrl" `
    --dart-define="CHAT_URL=$ChatUrl" `
    --dart-define="CALL_URL=$CallUrl" `
    --dart-define="BILLING_URL=$BillingUrl"

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Build successful!" -ForegroundColor Green
    Write-Host "Output: client/build/web" -ForegroundColor Green
    Write-Host ""
    Write-Host "To deploy:" -ForegroundColor Cyan
    Write-Host "1. Upload client/build/web to your static hosting (Render, Netlify, Vercel)"
    Write-Host "2. Or serve locally: npx http-server client/build/web -p 8080"
} else {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}
