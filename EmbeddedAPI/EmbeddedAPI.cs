using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Security.Cryptography;
using UnityEngine;

namespace EmbeddedAPI
{
    public static class API
    {
        private static readonly string sharedSecret = "embedded_dev_secret";
        private static readonly HttpClient client = new HttpClient();
        private static readonly string baseUrl = "http://localhost:3000/api";

        private static string GenerateSignature(string body, string timestamp)
        {
            var key = Encoding.UTF8.GetBytes(sharedSecret);
            var message = Encoding.UTF8.GetBytes(body + timestamp);

            using var hmac = new HMACSHA256(key);
            var hashBytes = hmac.ComputeHash(message);
            var hex = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();

            return hex;
        }

        private static void AddSecureHeaders(HttpRequestMessage request, string body)
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var signature = GenerateSignature(body, timestamp);

            request.Headers.Add("x-signature", signature);
            request.Headers.Add("x-timestamp", timestamp);
        }

        public static async Task<string> RegisterPlayerAsync(string walletAddress, string txSignature)
        {
            var payload = new
            {
                walletAddress,
                txSignature
            };

            var body = JsonUtility.ToJson(payload);
            var content = new StringContent(body, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/registerPlayer")
            {
                Content = content
            };

            AddSecureHeaders(request, body);

            var response = await client.SendAsync(request);
            response.EnsureSuccessStatusCode();

            using var responseStream = await response.Content.ReadAsStreamAsync();
            using var reader = new StreamReader(responseStream);
            var json = await reader.ReadToEndAsync();
            var result = JsonUtility.FromJson<RegisterResponse>(json);

            if (result == null || string.IsNullOrEmpty(result.matchId))
            {
                throw new InvalidOperationException("Failed to register player or retrieve match ID.");
            }

            return result.matchId;
        }

        public static async Task ReportMatchResultAsync(string matchId, string winnerWallet, string loserWallet)
        {
            var payload = new
            {
                matchID = matchId,
                winnerWallet,
                loserWallet
            };

            var body = JsonUtility.ToJson(payload);
            var content = new StringContent(body, Encoding.UTF8, "application/json");

            var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/matchComplete")
            {
                Content = content
            };

            AddSecureHeaders(request, body);

            var response = await client.SendAsync(request);
            response.EnsureSuccessStatusCode();
        }

        private class RegisterResponse
        {
            public string matchId { get; set; }
        }
    }
}