import uuid
from django.conf import settings
from django.db import models

class GameRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='game_records')
    client_id = models.UUIDField()
    mode = models.CharField(max_length=16)
    board_size = models.PositiveSmallIntegerField()
    mine_count = models.PositiveSmallIntegerField()
    weights = models.JSONField()
    result = models.CharField(max_length=4)
    duration_ms = models.PositiveBigIntegerField()
    finished_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'client_id'], name='one_record_per_game_per_user')]
        ordering = ['-finished_at', '-id']

class LoginTicket(models.Model):
    digest = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    expires_at = models.DateTimeField()

class AccessToken(models.Model):
    digest = models.CharField(max_length=64, primary_key=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    expires_at = models.DateTimeField()

class HintBalance(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hint_balance')
    credits = models.PositiveIntegerField(default=0)
    promo_digest = models.CharField(max_length=64, blank=True, default='')
    promo_ready_at = models.DateTimeField(null=True, blank=True)
    test_premium = models.BooleanField(default=False)
    daily_credits = models.PositiveIntegerField(default=0)
    daily_date = models.DateField(null=True, blank=True)
