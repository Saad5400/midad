<?php

declare(strict_types=1);

namespace Midad\Php;

use JsonException;

final class TaskClient
{
    public function __construct(
        private readonly string $socketPath,
        private readonly string $identity,
        private readonly float $timeout = 5,
        private readonly int $maxInputBytes = 33554432,
        private readonly int $maxOutputBytes = 67108864,
    ) {}

    public function request(mixed $payload, float $budget = 5, ?string $affinity = null): mixed
    {
        if (! is_finite($budget) || ! is_finite($this->timeout) || $budget <= 0 || $this->timeout <= 0) {
            throw new TaskException('The task deadline has expired.', 'deadline');
        }
        $deadline = microtime(true) + min($this->timeout, $budget);
        $id = bin2hex(random_bytes(16));
        try {
            $body = json_encode([
                'protocol' => 1, 'id' => $id, 'identity' => $this->identity,
                'budgetMs' => max(1, (int) floor(($deadline - microtime(true)) * 1000)),
                'payload' => $payload, ...($affinity !== null ? ['affinity' => $affinity] : []),
            ], JSON_THROW_ON_ERROR);
        } catch (JsonException $error) {
            throw new TaskException($error->getMessage(), 'invalid_input');
        }
        if ($this->maxInputBytes < 1 || strlen($body) > $this->maxInputBytes) {
            throw new TaskException('The task input exceeds its size limit.', 'input_limit');
        }
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            throw new TaskException('The task deadline has expired.', 'deadline');
        }
        $socket = @stream_socket_client('unix://'.$this->socketPath, $number, $message, $remaining);
        if ($socket === false) {
            throw new TaskException('The task service is unavailable.');
        }
        try {
            stream_set_blocking($socket, false);
            $this->write($socket, pack('N', strlen($body)).$body, $deadline);
            $length = unpack('Nlength', $this->read($socket, 4, $deadline))['length'];
            if ($length < 1 || $length > $this->maxOutputBytes) {
                throw new TaskException('The task response exceeds its size limit.', 'output_limit');
            }
            try {
                $reply = json_decode($this->read($socket, $length, $deadline), true, flags: JSON_THROW_ON_ERROR);
            } catch (JsonException $error) {
                throw new TaskException('The task response is not valid JSON.', 'invalid_response');
            }
            if (! is_array($reply) || ($reply['protocol'] ?? null) !== 1 || ($reply['id'] ?? null) !== $id || ! is_bool($reply['ok'] ?? null)) {
                throw new TaskException('The task response does not match its request.', 'invalid_response');
            }
            if (($reply['identity'] ?? null) !== $this->identity) {
                throw new TaskException('The task service identity changed.', 'runtime_changed');
            }
            if (! $reply['ok']) {
                throw new TaskException(
                    is_string($reply['error']['message'] ?? null) ? $reply['error']['message'] : 'The task failed.',
                    ($reply['error']['code'] ?? null) === 'timeout' ? 'deadline' : (is_string($reply['error']['code'] ?? null) ? $reply['error']['code'] : 'invalid_response'),
                );
            }
            if (! array_key_exists('result', $reply)) {
                throw new TaskException('The task result is missing.', 'invalid_response');
            }
            if (microtime(true) > $deadline) {
                throw new TaskException('The task deadline has expired.', 'deadline');
            }

            return $reply['result'];
        } finally {
            fclose($socket);
        }
    }

    private function wait(mixed $socket, bool $writing, float $deadline): void
    {
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            throw new TaskException('The task deadline has expired.', 'deadline');
        }
        $read = $writing ? [] : [$socket];
        $write = $writing ? [$socket] : [];
        $except = [];
        $seconds = (int) $remaining;
        $microseconds = max(1, (int) (($remaining - $seconds) * 1000000));
        if (@stream_select($read, $write, $except, $seconds, $microseconds) !== 1) {
            throw new TaskException('The task transport timed out.', 'deadline');
        }
    }

    private function write(mixed $socket, string $data, float $deadline): void
    {
        $offset = 0;
        while ($offset < strlen($data)) {
            $this->wait($socket, true, $deadline);
            $written = @fwrite($socket, substr($data, $offset, 65536));
            if ($written === false || $written === 0) {
                throw new TaskException('The task transport closed unexpectedly.');
            }
            $offset += $written;
        }
    }

    private function read(mixed $socket, int $length, float $deadline): string
    {
        $data = '';
        while (strlen($data) < $length) {
            $this->wait($socket, false, $deadline);
            $chunk = @fread($socket, min(65536, $length - strlen($data)));
            if ($chunk === false || $chunk === '') {
                throw new TaskException('The task transport closed unexpectedly.');
            }
            $data .= $chunk;
        }

        return $data;
    }
}
