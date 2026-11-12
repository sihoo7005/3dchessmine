from django.http import Http404

class GoogleOnlyAccountRoutes:
    """Keep password/account-management routes unavailable; this service uses Google only."""
    allowed = {'/chessmine/accounts/google/login/', '/chessmine/accounts/google/login/callback/', '/chessmine/accounts/logout/'}
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/chessmine/accounts/') and request.path not in self.allowed:
            raise Http404
        return self.get_response(request)
