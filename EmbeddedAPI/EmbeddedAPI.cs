using System;
using System.Text;
using System.Threading.Tasks;
using System.Security.Cryptography;
using UnityEngine;
using UnityEngine.Networking;

namespace EmbeddedAPI
{
    public static class API
    {
        private static readonly string sharedSecret = "embedded_dev_secret";
        private static readonly string baseUrl = "http://localhost:3000/api";

        [Serializable]
        public class RegisterPayload
        {
            public string walletAddress;
            public string txSignature;
            public string game;
            public string region; // Photon region e.g., "eu", "us", "asia"
            public string mode; // Optional, can be "Casual" or "Betting"
            public string betAmount; // Optional, required if mode is "Betting"
        }

        [Serializable]
        public class RegisterResponse
        {
            public string matchId;
        }

        [Serializable]
        public class MatchCompletePayload
        {
            public string matchID;
            public string winnerWallet;
        }

        [Serializable]
        private class MatchJoinPayload
        {
            public string matchID;
            public string walletAddress;
        }

        private class AbortMatchPayload
        {
            public string matchID;
            public string walletAddress;
        }

        private static string GenerateSignature(string body, string timestamp)
        {
            var key = Encoding.UTF8.GetBytes(sharedSecret);
            var message = Encoding.UTF8.GetBytes(body + timestamp);

            using var hmac = new HMACSHA256(key);
            var hashBytes = hmac.ComputeHash(message);
            var hex = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();

            return hex;
        }

        private static void AddSecureHeaders(UnityWebRequest request, string body)
        {
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            var signature = GenerateSignature(body, timestamp);

            request.SetRequestHeader("Content-Type", "application/json");
            request.SetRequestHeader("x-signature", signature);
            request.SetRequestHeader("x-timestamp", timestamp);

            byte[] bodyRaw = Encoding.UTF8.GetBytes(body);
            request.uploadHandler = new UploadHandlerRaw(bodyRaw);
            request.downloadHandler = new DownloadHandlerBuffer();
        }

        public static async Task<string> RegisterPlayerAsync(string walletAddress, string txSignature, string game,
                                                             string region, string mode = null, string betAmount = null)
        {
            var payload = new RegisterPayload
            {
                walletAddress = walletAddress,
                txSignature = txSignature,
                game = game,
                mode = mode,
                region = region,
                betAmount = betAmount
            };

            var body = JsonUtility.ToJson(payload);
            var request = new UnityWebRequest(baseUrl + "/registerPlayer", "POST");

            AddSecureHeaders(request, body);

            await request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("Error: " + request.error);
                throw new InvalidOperationException($"Failed to register player and retrieve match ID.");
            }

            RegisterResponse responseData = JsonUtility.FromJson<RegisterResponse>(request.downloadHandler.text);

            if (string.IsNullOrEmpty(responseData.matchId))
            {
                throw new InvalidOperationException("Failed to register player and retrieve match ID.");
            }

            return responseData.matchId;
        }

        public static async Task<string> JoinMatchAsync(string matchId, string walletAddress)
        {
            var payload = new MatchJoinPayload
            {
                matchID = matchId,
                walletAddress = walletAddress
            };

            var jsonBody = JsonUtility.ToJson(payload);
            var request = new UnityWebRequest(baseUrl + "/matchJoin", "POST");

            AddSecureHeaders(request, jsonBody);

            await request.SendWebRequest();

            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError("Error: " + request.error);
                throw new InvalidOperationException($"Failed to join match with ID {matchId}.");
            }

            return request.downloadHandler.text;
        }

        public static async Task ReportMatchResultAsync(string matchId, string winnerWallet)
        {
            var payload = new MatchCompletePayload
            {
                matchID = matchId,
                winnerWallet = winnerWallet
            };

            var body = JsonUtility.ToJson(payload);

            var request = new UnityWebRequest(baseUrl + "/matchComplete", "POST");

            AddSecureHeaders(request, body);

            await request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                Debug.Log("Success: " + request.downloadHandler.text);
            else
                Debug.LogError("Error: " + request.error);
        }

        public static async Task AbortMatchAsync(string matchId, string walletAddress)
        {
            var payload = new AbortMatchPayload
            {
                matchID = matchId,
                walletAddress = walletAddress
            };

            var body = JsonUtility.ToJson(payload);
            var request = new UnityWebRequest(baseUrl + "/abortMatch", "POST");

            AddSecureHeaders(request, body);
            await request.SendWebRequest();

            if (request.result == UnityWebRequest.Result.Success)
                Debug.Log("Success: " + request.downloadHandler.text);
            else
                Debug.LogError("Error: " + request.error);
        }
    }
}