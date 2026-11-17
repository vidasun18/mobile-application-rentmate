import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'state.dart';
import 'strings.dart';
import 'ui.dart';
import 'history.dart';

Future<Json?> reasonForm(BuildContext context, {String title = 'submit'}) =>
    formPage(context, tr(title), [
      const FieldSpec('reason', 'reason', type: 'multiline'),
    ], help: tr('adminReason'));
Future<void> viewMedia(
  BuildContext context,
  Json media, {
  String? reason,
}) async {
  final api = context.read<AppState>();
  await act(context, () async {
    final result = await api.request(
      '/media/${media['id']}/view',
      method: 'POST',
      body: reason == null ? {} : {'reason': reason},
    );
    if (context.mounted) {
      await showDialog(
        context: context,
        builder: (_) => Dialog(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: InteractiveViewer(
                    child: Image.network(
                      result['url'],
                      errorBuilder: (_, e, s) => Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(tr('imageFailed')),
                      ),
                    ),
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: Text(tr('close')),
                ),
              ],
            ),
          ),
        ),
      );
      await NetworkImage(result['url']).evict();
    }
  });
}

class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});
  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  int version = 0;
  void reload() => setState(() => version++);
  Future<void> upload(String kind, {String? vehicle}) async {
    final api = context.read<AppState>();
    await act(context, () async {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 2200,
        imageQuality: 90,
      );
      if (file != null) {
        await api.upload(file.path, kind, vehicle: vehicle);
        await api.refreshUser();
      }
    });
    if (mounted) reload();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.watch<AppState>();
    final u = api.user!;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        HeroPanel(u['name'], subtitle: u['email']),
        const SizedBox(height: 12),
        StatusChip(u['status']),
        SectionCard(child: PersonCard({...u, ...?u['reputation']})),
        if (api.role != 'ADMIN')
          OutlinedButton.icon(
            onPressed: api.offline
                ? null
                : () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const HistoryPage()),
                  ),
            icon: const Icon(Icons.history),
            label: Text(tr('tripHistory')),
          ),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(tr('privacy')),
              const SizedBox(height: 18),
              FilledButton.icon(
                icon: const Icon(Icons.edit_outlined),
                label: Text(tr('save')),
                onPressed: api.offline
                    ? null
                    : () async {
                        await formPage(
                          context,
                          tr('save'),
                          [
                            FieldSpec('name', 'name', initial: u['name']),
                            FieldSpec('phone', 'phone', initial: u['phone']),
                            FieldSpec(
                              'bio',
                              'bio',
                              initial: u['bio'] ?? '',
                              optional: true,
                              type: 'multiline',
                            ),
                            if (api.role == 'DRIVER') ...[
                              FieldSpec(
                                'licence_number',
                                'licence',
                                initial:
                                    u['driver_profile']?['licence_number'] ??
                                    '',
                                optional: true,
                              ),
                              FieldSpec(
                                'licence_expiry',
                                'licenceExpiry',
                                initial:
                                    '${u['driver_profile']?['licence_expiry'] ?? ''}'
                                        .split('T')
                                        .first,
                                optional: true,
                              ),
                            ],
                            if (api.role == 'AGENT') ...[
                              FieldSpec(
                                'agency_name',
                                'agencyName',
                                initial:
                                    u['agent_profile']?['agency_name'] ?? '',
                              ),
                              FieldSpec(
                                'location',
                                'location',
                                initial: u['agent_profile']?['location'] ?? '',
                              ),
                            ],
                          ],
                          submit: (b) async {
                            await api.request('/me', method: 'PUT', body: b);
                            await api.refreshUser();
                          },
                        );
                        if (mounted) reload();
                      },
              ),
              OutlinedButton(
                onPressed: () => act(context, api.refreshUser),
                child: Text(tr('checkStatus')),
              ),
              if (api.role == 'AGENT' || api.role == 'DRIVER') ...[
                OutlinedButton.icon(
                  onPressed: api.offline ? null : () => upload('PROFILE_PHOTO'),
                  icon: const Icon(Icons.portrait_outlined),
                  label: Text(tr('uploadProfile')),
                ),
                OutlinedButton.icon(
                  onPressed: api.offline ? null : () => upload('DOCUMENT'),
                  icon: const Icon(Icons.upload_file_outlined),
                  label: Text(tr('uploadDocument')),
                ),
                Text(tr('photoPending')),
                OutlinedButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => Scaffold(
                        appBar: AppBar(title: Text(tr('documents'))),
                        body: RemoteList(
                          load: () async =>
                              (await api.request('/media') as List)
                                  .cast<Json>(),
                          item: (m, r) => Card(
                            child: ListTile(
                              title: Text(m['kind']),
                              subtitle: Text(date(m['created_at'])),
                              trailing: const Icon(Icons.open_in_new),
                              onTap: () => viewMedia(context, m),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  child: Text(tr('documents')),
                ),
              ],
              if (api.role == 'DRIVER')
                OutlinedButton.icon(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const VehiclesPage()),
                  ),
                  icon: const Icon(Icons.directions_car_outlined),
                  label: Text(tr('vehicles')),
                ),
              OutlinedButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => Scaffold(
                      appBar: AppBar(title: Text(tr('rating'))),
                      body: RemoteList(
                        load: () async =>
                            (await api.request('/ratings/me') as List)
                                .cast<Json>(),
                        item: (r, reload) => SectionCard(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('★ ${r['score']}'),
                              Text(r['comment']),
                              Text(date(r['created_at'])),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                child: Text(tr('rating')),
              ),
              TextButton.icon(
                onPressed: api.logout,
                icon: const Icon(Icons.logout),
                label: Text(tr('logout')),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class VehiclesPage extends StatefulWidget {
  const VehiclesPage({super.key});
  @override
  State<VehiclesPage> createState() => _VehiclesPageState();
}

class _VehiclesPageState extends State<VehiclesPage> {
  int version = 0;
  Future<void> edit([Json? vehicle]) async {
    final api = context.read<AppState>();
    await formPage(
      context,
      tr(vehicle == null ? 'addVehicle' : 'editVehicle'),
      [
        FieldSpec(
          'type',
          'vehicleType',
          initial: vehicle?['type'] ?? 'CAR',
          options: const {'CAR': 'car', 'VAN': 'van', 'KDH': 'kdh'},
        ),
        FieldSpec(
          'registration',
          'registration',
          initial: vehicle?['registration'] ?? '',
        ),
        FieldSpec('model', 'model', initial: vehicle?['model'] ?? ''),
        FieldSpec(
          'seats',
          'seats',
          type: 'integer',
          initial: '${vehicle?['seats'] ?? 4}',
        ),
      ],
      submit: (b) async {
        await api.request(
          '/vehicles${vehicle == null ? '' : '/${vehicle['id']}'}',
          method: vehicle == null ? 'POST' : 'PUT',
          body: b,
        );
      },
    );
    if (mounted) setState(() => version++);
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(tr('vehicles'))),
      floatingActionButton: FloatingActionButton(
        onPressed: () => edit(),
        tooltip: tr('addVehicle'),
        child: const Icon(Icons.add),
      ),
      body: RemoteList(
        key: ValueKey(version),
        load: () async => (await api.request('/vehicles') as List).cast<Json>(),
        item: (v, reload) => SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${v['model']} · ${v['registration']}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              Text('${v['type']} · ${v['seats']} ${tr('seats')}'),
              StatusChip(v['approved'] ? 'APPROVED' : 'PENDING'),
              PersonCard({
                'name': v['model'],
                'vehicle': {
                  ...v,
                  'photos': (v['photos'] as List)
                      .where((p) => p['url'] != null)
                      .toList(),
                },
              }),
              Wrap(
                spacing: 8,
                children: [
                  OutlinedButton(
                    onPressed: () => edit(v),
                    child: Text(tr('editVehicle')),
                  ),
                  OutlinedButton(
                    onPressed: () async {
                      await act(context, () async {
                        final file = await ImagePicker().pickImage(
                          source: ImageSource.gallery,
                          maxWidth: 2200,
                          imageQuality: 90,
                        );
                        if (file != null) {
                          await api.upload(
                            file.path,
                            'VEHICLE_PHOTO',
                            vehicle: v['id'],
                          );
                        }
                      });
                      reload();
                    },
                    child: Text(tr('uploadPhoto')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class AdminPage extends StatefulWidget {
  const AdminPage({super.key});
  @override
  State<AdminPage> createState() => _AdminPageState();
}

class _AdminPageState extends State<AdminPage> {
  String status = 'PENDING';
  int version = 0;
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: DropdownButtonFormField<String>(
            initialValue: status,
            decoration: InputDecoration(labelText: tr('statusFilter')),
            items: [
              for (final s in ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'])
                DropdownMenuItem(value: s, child: Text(tr(s))),
            ],
            onChanged: (s) => setState(() {
              status = s!;
              version++;
            }),
          ),
        ),
        Expanded(
          child: RemoteList(
            key: ValueKey(version),
            load: () async =>
                (await api.request('/admin/users?status=$status') as List)
                    .cast<Json>(),
            item: (u, reload) => SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    u['name'],
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Text(tr((u['role'] as String).toLowerCase())),
                  StatusChip(u['status']),
                  OutlinedButton(
                    onPressed: () async {
                      final reason = await reasonForm(
                        context,
                        title: 'reviewPrivate',
                      );
                      if (reason == null || !context.mounted) return;
                      await act(context, () async {
                        final details = await api.request(
                          '/admin/users/${u['id']}/details',
                          method: 'POST',
                          body: reason,
                        );
                        if (context.mounted) {
                          await Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => AdminDetails(
                                user: details,
                                reason: reason['reason'],
                              ),
                            ),
                          );
                        }
                      });
                      reload();
                    },
                    child: Text(tr('reviewPrivate')),
                  ),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final s in ['APPROVED', 'REJECTED', 'SUSPENDED'])
                        OutlinedButton(
                          onPressed: () async {
                            final b = await reasonForm(
                              context,
                              title: s == 'APPROVED'
                                  ? 'approve'
                                  : s == 'REJECTED'
                                  ? 'reject'
                                  : 'suspend',
                            );
                            if (b == null || !context.mounted) return;
                            await act(
                              context,
                              () => api.request(
                                '/admin/users/${u['id']}',
                                method: 'PATCH',
                                body: {...b, 'status': s},
                              ),
                            );
                            reload();
                          },
                          child: Text(
                            tr(
                              s == 'APPROVED'
                                  ? 'approve'
                                  : s == 'REJECTED'
                                  ? 'reject'
                                  : 'suspend',
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class AdminDetails extends StatelessWidget {
  final Json user;
  final String reason;
  const AdminDetails({super.key, required this.user, required this.reason});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(tr('privateDetails'))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(user['name']),
                Text(user['email']),
                Text(user['phone']),
                if (user['driver_profile'] != null) ...[
                  Text(
                    '${tr('licence')}: ${user['driver_profile']['licence_number']}',
                  ),
                  Text(
                    '${tr('licenceExpiry')}: ${user['driver_profile']['licence_expiry'] ?? ''}',
                  ),
                ],
              ],
            ),
          ),
          for (final m in user['documents'])
            OutlinedButton.icon(
              onPressed: () => viewMedia(context, m, reason: reason),
              icon: const Icon(Icons.description_outlined),
              label: Text(tr('view')),
            ),
          for (final photo in (user['profile_photos'] as List? ?? []))
            SectionCard(
              child: Column(
                children: [
                  if (photo['approved'])
                    Image.network(
                      photo['url'],
                      height: 140,
                      errorBuilder: (_, e, s) => Text(tr('imageFailed')),
                    ),
                  StatusChip(photo['approved'] ? 'APPROVED' : 'PENDING'),
                  OutlinedButton(
                    onPressed: () => viewMedia(context, photo, reason: reason),
                    child: Text(tr('view')),
                  ),
                  OutlinedButton(
                    onPressed: () => act(
                      context,
                      () => api.request(
                        '/admin/media/${photo['id']}',
                        method: 'PATCH',
                        body: {'reason': reason},
                      ),
                    ),
                    child: Text(tr('approve')),
                  ),
                ],
              ),
            ),
          for (final v in user['vehicles'])
            SectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  PersonCard({
                    'name': v['model'],
                    'vehicle': {
                      ...v,
                      'photos': (v['photos'] as List? ?? [])
                          .where((p) => p['approved'] == true)
                          .toList(),
                    },
                  }),
                  StatusChip(v['approved'] ? 'APPROVED' : 'PENDING'),
                  for (final photo in (v['photos'] as List? ?? []))
                    OutlinedButton.icon(
                      onPressed: () =>
                          viewMedia(context, photo, reason: reason),
                      icon: const Icon(Icons.photo_outlined),
                      label: Text(tr('view')),
                    ),
                  OutlinedButton(
                    onPressed: () => act(
                      context,
                      () => api.request(
                        '/admin/vehicles/${v['id']}',
                        method: 'PATCH',
                        body: {'reason': reason},
                      ),
                    ),
                    child: Text(tr('approveVehicle')),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class AuditPage extends StatelessWidget {
  const AuditPage({super.key});
  @override
  Widget build(BuildContext context) {
    final api = context.read<AppState>();
    return RemoteList(
      load: () async =>
          (await api.request('/admin/audit') as List).cast<Json>(),
      item: (a, r) => SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(a['action']),
            Text(a['reason']),
            Text(date(a['created_at'])),
            SelectableText('${a['actor_id'] ?? ''}\n${a['resource_id'] ?? ''}'),
            if (a['resource_id'] != null &&
                (a['action'].toString().startsWith('TOUR_') ||
                    [
                      'DETAILS_SENT',
                      'CONTACT_RELEASED',
                      'CONTACT_REVOKED',
                      'DRIVER_WITHDRAWN',
                      'ADMIN_TOUR_PRIVATE_VIEW',
                    ].contains(a['action'])))
              OutlinedButton(
                onPressed: () async {
                  final reason = await reasonForm(context, title: 'reviewTrip');
                  if (reason == null || !context.mounted) return;
                  await act(context, () async {
                    final trip = await api.request(
                      '/admin/tours/${a['resource_id']}/details',
                      method: 'POST',
                      body: reason,
                    );
                    if (context.mounted) {
                      await Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => AdminTripDetails(trip: trip),
                        ),
                      );
                    }
                  });
                },
                child: Text(tr('reviewTrip')),
              ),
          ],
        ),
      ),
    );
  }
}

class AdminTripDetails extends StatelessWidget {
  final Json trip;
  const AdminTripDetails({super.key, required this.trip});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(tr('privateDetails'))),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        HeroPanel(
          '${trip['pickup']} → ${trip['destination']}',
          subtitle: date(trip['starts_at']),
        ),
        StatusChip(trip['status']),
        SectionCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(trip['tourist']['name']),
              Text(trip['tourist']['phone']),
              if (trip['quote'] != null) ...[
                Text('${tr('total')}: ${money(trip['quote']['total_minor'])}'),
                Text(
                  '${tr('deposit')}: ${money(trip['quote']['deposit_minor'])}',
                ),
              ],
              if (trip['payout_minor'] != null)
                Text('${tr('payout')}: ${money(trip['payout_minor'])}'),
              if (trip['commission_minor'] != null)
                Text('${tr('commission')}: ${money(trip['commission_minor'])}'),
            ],
          ),
        ),
        if (trip['assignment'] != null)
          SectionCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                PersonCard(trip['assignment']['card']),
                Text(trip['assignment']['phone']),
              ],
            ),
          ),
      ],
    ),
  );
}
