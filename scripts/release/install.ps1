& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $base = '__IORI_RELEASE_SOURCE__'
    $base += if ($env:IORI_VERSION) { "/download/v$env:IORI_VERSION" } else { "/latest/download" }
    $destination = Join-Path $env:LOCALAPPDATA 'Programs\iori-host'
    $first = -not (Test-Path -LiteralPath (Join-Path $destination 'iori-host.cmd'))
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    $work = Join-Path (Split-Path $destination) ('.iori-host-' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $work | Out-Null
    $previousLocation = Get-Location
    $previousDirectory = [Environment]::CurrentDirectory
    try {
        # Release a caller's working directory inside the bundle before replacing it.
        Set-Location -LiteralPath $work
        [Environment]::CurrentDirectory = $work
        $asset = 'iori-host-windows-x64.zip'
        $expectedSha256 = $env:IORI_EXPECTED_SHA256
        $expectedSize = $null
        if (-not $expectedSha256) {
            Invoke-WebRequest "$base/release.json" -OutFile "$work\release.json" -UseBasicParsing
            Invoke-WebRequest "$base/release.json.sig" -OutFile "$work\release.json.sig" -UseBasicParsing
            if (-not ([System.Management.Automation.PSTypeName]'IoriEd25519').Type) {
                # RFC 8032 sections 5.1.7 and 6. Windows PowerShell 5.1 has
                # BigInteger and SHA-512 but no Ed25519 verification API.
                $verifier = @'
using System;
using System.Numerics;
using System.Security.Cryptography;

public static class IoriEd25519 {
    static readonly BigInteger P = (BigInteger.One << 255) - 19;
    static readonly BigInteger L = (BigInteger.One << 252) + BigInteger.Parse("27742317777372353535851937790883648493");
    static readonly BigInteger D = Mod(-121665 * Inverse(121666));
    static readonly BigInteger SqrtMinusOne = BigInteger.ModPow(2, (P - 1) / 4, P);
    static readonly Point Identity = new Point(0, 1, 1, 0);
    static readonly Point Base = Decode(Convert.FromBase64String("WGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY="), 0);

    // Extended Edwards coordinates: x = X/Z, y = Y/Z, T = X*Y/Z.
    sealed class Point {
        public readonly BigInteger X, Y, Z, T;
        public Point(BigInteger x, BigInteger y, BigInteger z, BigInteger t) {
            X = x; Y = y; Z = z; T = t;
        }
    }

    static BigInteger Mod(BigInteger value) {
        value %= P;
        return value.Sign < 0 ? value + P : value;
    }

    static BigInteger Inverse(BigInteger value) {
        return BigInteger.ModPow(Mod(value), P - 2, P);
    }

    static BigInteger UnsignedLittleEndian(byte[] bytes, int offset, int length) {
        byte[] value = new byte[length + 1];
        Buffer.BlockCopy(bytes, offset, value, 0, length);
        return new BigInteger(value);
    }

    static Point Decode(byte[] bytes, int offset) {
        BigInteger encoded = UnsignedLittleEndian(bytes, offset, 32);
        bool odd = (encoded >> 255) == BigInteger.One;
        BigInteger y = encoded & ((BigInteger.One << 255) - 1);
        if (y >= P) return null;
        BigInteger yy = Mod(y * y);
        BigInteger xSquared = Mod((yy - 1) * Inverse(D * yy + 1));
        BigInteger x = BigInteger.ModPow(xSquared, (P + 3) / 8, P);
        if (Mod(x * x) != xSquared) x = Mod(x * SqrtMinusOne);
        if (Mod(x * x) != xSquared || (x.IsZero && odd)) return null;
        if (x.IsEven == odd) x = P - x;
        return new Point(x, y, 1, Mod(x * y));
    }

    static Point Add(Point left, Point right) {
        BigInteger a = Mod((left.Y - left.X) * (right.Y - right.X));
        BigInteger b = Mod((left.Y + left.X) * (right.Y + right.X));
        BigInteger c = Mod(2 * left.T * right.T * D);
        BigInteger d = Mod(2 * left.Z * right.Z);
        return new Point(Mod((b - a) * (d - c)), Mod((d + c) * (b + a)),
            Mod((d - c) * (d + c)), Mod((b - a) * (b + a)));
    }

    static Point Multiply(Point point, BigInteger scalar) {
        Point result = Identity;
        while (scalar > 0) {
            if (!scalar.IsEven) result = Add(result, point);
            point = Add(point, point);
            scalar >>= 1;
        }
        return result;
    }

    static bool Equal(Point left, Point right) {
        return Mod(left.X * right.Z - right.X * left.Z).IsZero &&
            Mod(left.Y * right.Z - right.Y * left.Z).IsZero;
    }

    public static bool Verify(byte[] key, byte[] message, byte[] signature) {
        if (key.Length != 32 || signature.Length != 64) return false;
        BigInteger s = UnsignedLittleEndian(signature, 32, 32);
        if (s >= L) return false;
        Point a = Decode(key, 0);
        Point r = Decode(signature, 0);
        if (a == null || r == null || Equal(Multiply(a, 8), Identity) || Equal(Multiply(r, 8), Identity)) return false;

        byte[] input = new byte[64 + message.Length];
        Buffer.BlockCopy(signature, 0, input, 0, 32);
        Buffer.BlockCopy(key, 0, input, 32, 32);
        Buffer.BlockCopy(message, 0, input, 64, message.Length);
        using (SHA512 sha = SHA512.Create()) {
            BigInteger k = UnsignedLittleEndian(sha.ComputeHash(input), 0, 64) % L;
            return Equal(Multiply(Base, s), Add(r, Multiply(a, k)));
        }
    }
}
'@
                if ($PSVersionTable.PSEdition -eq 'Core') {
                    Add-Type -TypeDefinition $verifier
                } else {
                    Add-Type -TypeDefinition $verifier -ReferencedAssemblies System.Numerics
                }
            }
            # release-public-key.txt contains the raw 32-byte Ed25519 key in base64.
            $releasePublicKey = 'u3a8q9j/g7UgqFM2kDVhtOdDzd0dOsiFO/kpbF6Abns='
            if ($env:IORI_RELEASE_PUBLIC_KEY) { $releasePublicKey = $env:IORI_RELEASE_PUBLIC_KEY }
            $manifestBytes = [IO.File]::ReadAllBytes("$work\release.json")
            $signature = [IO.File]::ReadAllBytes("$work\release.json.sig")
            if (-not [IoriEd25519]::Verify([Convert]::FromBase64String($releasePublicKey), $manifestBytes, $signature)) {
                throw 'Could not verify iori Host. Retry downloading.'
            }
            $manifest = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString($manifestBytes))
            $matching = @($manifest.assets | Where-Object { [string]::Equals($_.name, $asset, [StringComparison]::Ordinal) })
            if ($matching.Count -ne 1 -or ($env:IORI_VERSION -and $manifest.version -cne $env:IORI_VERSION)) {
                throw 'Could not verify iori Host. Retry downloading.'
            }
            $expectedSha256 = $matching[0].sha256
            $expectedSize = $matching[0].size
            if (($expectedSize -isnot [int] -and $expectedSize -isnot [long]) -or
                $expectedSize -le 0 -or $expectedSize -gt 9007199254740991 -or
                $expectedSha256 -isnot [string] -or $expectedSha256 -cnotmatch '\A[a-f0-9]{64}\z') {
                throw 'Could not verify iori Host. Retry downloading.'
            }
        }
        Invoke-WebRequest "$base/$asset" -OutFile "$work\host.zip" -UseBasicParsing
        if (($null -ne $expectedSize -and (Get-Item -LiteralPath "$work\host.zip").Length -ne $expectedSize) -or
            (Get-FileHash -LiteralPath "$work\host.zip" -Algorithm SHA256).Hash -ine $expectedSha256) {
            throw 'Could not verify iori Host. Retry downloading.'
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory("$work\host.zip", "$work\host")
        & {
# IORI_INSTALL_BUNDLE
        } -Bundle "$work\host"
        Write-Host 'iori Hostを起動しました。'
        if ($first) { & "$destination\iori-host.cmd" invite }
    } finally {
        $parent = Split-Path $destination
        Set-Location -LiteralPath $parent
        [Environment]::CurrentDirectory = $parent
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
        if (Test-Path -LiteralPath $previousLocation.Path) { Set-Location -LiteralPath $previousLocation.Path }
        if (Test-Path -LiteralPath $previousDirectory) { [Environment]::CurrentDirectory = $previousDirectory }
    }
}
